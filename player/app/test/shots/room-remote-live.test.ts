// The room screen's phone-remote slot as the live client gives it (issue #202): each state of a
// session on the fake live process, taken from the live service's room view, drawn on the real
// room page in headless Chrome. Screenshots to screenshots/room-remote-live-*.png for the design
// review; the QR code drawn is the one of `<site>/control#<join code>` and nothing else; the page never
// holds the host token, the session id or a control code. Needs `npm run build` first. No network.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { controlAddress, remoteViewOf } from "../../src/core/room/remote.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";
import { CONTROL_CODE, DEVICE_TOKEN, HOST_TOKEN, JOIN_CODE, ORIGIN, rig, SESSION_ID } from "../unit/live-relay.ts";
import type { Rig } from "../unit/live-relay.ts";
import { QR_QUIET, qrCode } from "../../src/core/room/qr.ts";
import { launchChrome, SHOT_DIR } from "./page.ts";
import { frameOf, on, openRoom, ROUTES, wiggle } from "./room-page.ts";
import { bandShape, bandText, probePage } from "./room-measure.ts";

const SIZES: readonly (readonly [number, number])[] = [[1920, 1080], [1024, 768]];

/** Plays the fake live process up to a state; returns the slot the room window would be sent. */
async function slotAfter(steps: (r: Rig) => Promise<void> | void): Promise<RemoteView> {
  const r = rig();
  await steps(r);
  return remoteViewOf(r.live.roomView());
}
const welcomed = async (r: Rig): Promise<void> => {
  r.live.start();
  await r.advance(0);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  // As with a second display: the presenter asks for a control code. The room must not see it.
  r.live.makeCode();
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
};

const STATES: readonly { name: string; steps: (r: Rig) => Promise<void> | void }[] = [
  { name: "off", steps: () => undefined },
  { name: "starting", steps: (r) => void r.live.start() },
  { name: "on", steps: welcomed },
  {
    name: "phone-connected",
    steps: async (r) => {
      await welcomed(r);
      r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
    },
  },
  {
    name: "reconnecting",
    steps: async (r) => {
      await welcomed(r);
      r.socket().drop(1006);
    },
  },
  {
    name: "ended",
    steps: async (r) => {
      await welcomed(r);
      r.socket().server({ v: 1, type: "ended", reason: "expired" });
    },
  },
  {
    name: "in-use",
    steps: async (r) => {
      r.answer = { kind: "http", status: 409, body: { error: "sessions_full" }, retryAfterS: null };
      r.live.start();
      await r.advance(0);
    },
  },
];

/** The band's QR code as drawn: for each module's centre, whether the dark path is there. */
function readDrawn(): { side: number; dark: boolean[][] } | null {
  const svg = document.querySelector(".band svg.qr");
  if (!svg) return null;
  const side = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  const r = svg.getBoundingClientRect();
  const m = r.width / side;
  const dark = Array.from({ length: side }, (_, y) => Array.from({ length: side }, (_, x) => document.elementFromPoint(r.left + (x + 0.5) * m, r.top + (y + 0.5) * m)?.tagName === "path"));
  return { side, dark };
}

let browser: Browser;
let probe: Page;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
  probe = await probePage(browser);
});
after(async () => {
  await browser?.close();
});

for (const s of STATES) {
  test(`the live client's slot, ${s.name}: screenshots, the band's checks, the QR code and no secret`, { timeout: 120_000 }, async () => {
    const view = await slotAfter(s.steps);
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      // "Phone remote ended" shows only when it arrives while the room window is open.
      const late = view.slot === "available" && view.note === "ended";
      const o = await openRoom(browser, { size, frame: frameOf("running", ROUTES.following), remote: late ? on(1) : view });
      try {
        if (late) await o.pushRemote(view);
        await wiggle(o.page);
        assert.equal(await o.phase(), "shown", name);
        await o.page.screenshot({ path: join(SHOT_DIR, `room-remote-live-${name}.png`) });
        assert.deepEqual([...(await bandShape(o.page)), ...(await bandText(o.page, probe, size))], [], name);
        const drawn = await o.page.evaluate(readDrawn);
        if (view.slot === "on") {
          assert.ok(drawn !== null, `${name}: the QR code is shown`);
          const rows = drawn.dark.slice(QR_QUIET, drawn.side - QR_QUIET).map((row) => row.slice(QR_QUIET, drawn.side - QR_QUIET));
          // The drawn modules are exactly the code of `<site>/control#<join code>` (the encoder,
          // with its own reader checks, is room-qr.test.ts; this address needs level L there).
          assert.deepEqual(rows, qrCode(controlAddress(ORIGIN, JOIN_CODE))!.modules, `${name}: the QR code is the join code's address`);
          assert.equal(await o.page.textContent(".band .code .v"), JOIN_CODE);
        } else {
          assert.equal(drawn, null, `${name}: no QR code`);
        }
        const html = await o.page.evaluate(() => new XMLSerializer().serializeToString(document));
        for (const secret of [HOST_TOKEN, SESSION_ID, DEVICE_TOKEN, CONTROL_CODE, CONTROL_CODE.replace("-", ""), "cbp_"]) assert.ok(!html.includes(secret), `${name}: ${secret} in the page`);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors`);
      } finally {
        await o.close();
      }
    }
  });
}

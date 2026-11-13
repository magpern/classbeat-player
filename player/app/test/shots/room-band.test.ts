// The room screen's control band in every state (room-2d.md, "Controls on the room screen"): the real
// room page in headless Chrome, screenshots to screenshots/room-band-*.png for the design review,
// and check C10's static part on each: the band's text (C1 to C4), its box, buttons, QR code and
// colours, and the pixels (hidden is the screen without the band; shown differs only in the score's
// box). The worst case runs at all ten room sizes. Needs `npm run build` first.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { HIDE_AFTER_MS } from "../../src/core/room/band-model.ts";
import { lastsUntilHidden } from "../../src/core/room/remote.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";
import { launchChrome, SHOT_DIR } from "./page.ts";
import { frameOf, on, openRoom, ROUTES, wiggle } from "./room-page.ts";
import type { RoomOpen, RoomOpenOptions } from "./room-page.ts";
import { addSheet, askShape, bandShape, bandText, endBox, probePage, rows, scoreRows } from "./room-measure.ts";

const SMALL: readonly [number, number] = [1024, 768];
const WIDE: readonly [number, number] = [1920, 1080];
const TWO = [WIDE, SMALL] as const;
const ALL_SIZES: readonly (readonly [number, number])[] = [
  [2560, 1080], [1920, 1080], [1280, 720], [1680, 1050], [1280, 800],
  [1650, 1080], [1620, 1080], [1440, 1080], [1024, 768], [1280, 1024],
];

interface BandShot {
  readonly name: string;
  readonly sizes: readonly (readonly [number, number])[];
  readonly open: Omit<RoomOpenOptions, "size">;
  /** Brings the band up (pinned states are up already). */
  readonly show?: (o: RoomOpen) => Promise<void>;
  readonly ask?: true;
}

const showByMove = async (o: RoomOpen): Promise<void> => wiggle(o.page);
const showByTab = async (o: RoomOpen): Promise<void> => o.page.keyboard.press("Tab");
const AVAILABLE: RemoteView = { slot: "available", note: "none" };

const SHOTS: readonly BandShot[] = [
  { name: "before-start-code", sizes: TWO, open: { frame: frameOf("before-start", ROUTES.clock), remote: on(0) } },
  { name: "before-start-manual-remote-off", sizes: TWO, open: { frame: frameOf("before-start-manual"), remote: AVAILABLE } },
  { name: "running-following-1-phone", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: on(1) }, show: showByMove },
  { name: "paused-following-1-phone", sizes: TWO, open: { frame: frameOf("paused", ROUTES.following), remote: on(1) }, show: showByMove },
  { name: "running-manual-no-remote", sizes: TWO, open: { frame: frameOf("manual"), remote: { slot: "absent" } }, show: showByMove },
  { name: "running-tab-focus", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: on(1) }, show: showByTab },
  { name: "slot-starting", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: { slot: "starting" } }, show: showByMove },
  { name: "slot-reconnecting", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: on(1, true) }, show: showByMove },
  { name: "slot-refused", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: { slot: "available", note: "in_use" } }, show: showByMove },
  { name: "slot-unreachable", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: { slot: "available", note: "unreachable" } }, show: showByMove },
  { name: "slot-ended", sizes: TWO, open: { frame: frameOf("running", ROUTES.following), remote: { slot: "available", note: "ended" } }, show: showByMove },
  { name: "end-question", sizes: ALL_SIZES, open: { frame: frameOf("running", ROUTES.following), remote: on(1) }, show: showByMove, ask: true },
  { name: "finished", sizes: TWO, open: { frame: frameOf("finished"), remote: on(1) } },
  { name: "worst-handover-2-phones", sizes: ALL_SIZES, open: { frame: frameOf("worst-running", ROUTES.handover), remote: on(2) }, show: showByMove },
  { name: "worst-before-start-remote-refused", sizes: ALL_SIZES, open: { frame: frameOf("worst-before-start", ROUTES.handover), remote: { slot: "available", note: "in_use" } } },
  { name: "reduced-motion", sizes: [WIDE], open: { frame: frameOf("running", ROUTES.following), remote: on(1), reducedMotion: true }, show: showByMove },
];

let browser: Browser;
let probe: Page;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
  probe = await probePage(browser);
});
after(async () => {
  await browser?.close();
});

for (const shot of SHOTS) {
  test(`band ${shot.name}: screenshots and check C10 at each size`, { timeout: 300_000 }, async () => {
    for (const size of shot.sizes) {
      const name = `${shot.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      // An "ended" or "Can't reach site" note shows only when it arrives while the room window is open.
      const late = shot.open.remote !== undefined && lastsUntilHidden(shot.open.remote);
      const o = await openRoom(browser, { ...shot.open, size, remote: late ? on(1) : shot.open.remote });
      try {
        if (late) await o.pushRemote(shot.open.remote!);
        await shot.show?.(o);
        let end = null;
        if (shot.ask) {
          end = await endBox(o.page);
          await o.page.keyboard.press("End");
          await o.run(20);
        }
        assert.equal(await o.phase(), "shown", name);
        await o.page.screenshot({ path: join(SHOT_DIR, `room-band-${name}.png`) });
        const problems = [...(await bandShape(o.page)), ...(await bandText(o.page, probe, size))];
        if (end) problems.push(...(await askShape(o.page, end)));
        // The checks ran on the band as drawn: time did not move under them.
        assert.equal(await o.phase(), "shown", `${name}: the band moved during the checks`);
        assert.deepEqual(problems, [], name);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors`);
      } finally {
        await o.close();
      }
    }
  });
}

test("hidden: the screen is the screen without the band, pixel for pixel, with no pointer; shown: it differs only in the score's box", { timeout: 300_000 }, async () => {
  for (const [fixture, size] of [["running", WIDE], ["worst-running", SMALL], ["manual", [1280, 1024]]] as const) {
    const name = `${fixture}-${size[0]}x${size[1]}`;
    if (only && !only.test(`hidden-${name}`)) continue;
    const o = await openRoom(browser, { size, frame: frameOf(fixture, ROUTES.following), remote: on(1) });
    try {
      const H = size[1];
      const [top, bottom] = await scoreRows(o.page);
      assert.equal(await o.phase(), "hidden");
      const hidden = await rows(o.page, 0, H);
      assert.equal(await o.page.evaluate(() => getComputedStyle(document.body).cursor), "none", `${name}: the pointer shows`);
      await o.page.screenshot({ path: join(SHOT_DIR, `room-band-hidden-${name}.png`) });
      const restore = await addSheet(o.page, ".band { display: none !important; }");
      assert.ok((await rows(o.page, 0, H)).equals(hidden), `${name}: hidden differs from the screen without the band`);
      await restore();
      const above = await rows(o.page, 0, top);
      const below = bottom < H ? await rows(o.page, bottom, H) : null;
      await wiggle(o.page);
      assert.equal(await o.phase(), "shown");
      assert.ok((await rows(o.page, 0, top)).equals(above), `${name}: the band changes pixels above the score`);
      if (below) assert.ok((await rows(o.page, bottom, H)).equals(below), `${name}: the band changes pixels below the score`);
      assert.notEqual(await o.page.evaluate(() => getComputedStyle(document.body).cursor), "none", `${name}: the pointer stays hidden`);
    } finally {
      await o.close();
    }
  }
});

test("Can't reach site: shown until the band next hides; nothing starts by itself; one press makes one start", { timeout: 120_000 }, async () => {
  if (only && !only.test("unreachable-press")) return;
  const o = await openRoom(browser, { size: WIDE, frame: frameOf("running", ROUTES.following), remote: AVAILABLE });
  const sub = (): Promise<string | null> => o.page.textContent('.band [data-id="remote"] .sub');
  try {
    await o.pushRemote({ slot: "available", note: "unreachable" });
    await wiggle(o.page);
    assert.equal(await sub(), "Can't reach site");
    // Time passing and the band hiding and showing again start nothing; the note is gone.
    await o.run(HIDE_AFTER_MS + 2000);
    assert.equal(await o.phase(), "hidden");
    await o.run(60_000);
    await wiggle(o.page);
    assert.equal(await o.phase(), "shown");
    assert.equal(await sub(), "Show the class code");
    assert.deepEqual(await o.calls(), [], "nothing started without a press");
    await o.page.click('.band [data-id="remote"]');
    await o.run(20);
    assert.deepEqual(await o.calls(), ["startRemote"], "one press, one start");
    await o.run(60_000);
    assert.deepEqual(await o.calls(), ["startRemote"], "no start after the press by itself");
    assert.deepEqual(o.errors, []);
  } finally {
    await o.close();
  }
});

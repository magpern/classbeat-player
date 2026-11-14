// The room screen's phone-remote slot on the built app (issue #202; room-2d.md, "The class code"):
// pairing and opening a class start nothing; the band's Phone remote button starts the live
// session on the fake live process; the room then shows the class code and the phones connected,
// and never the host token or a control code, in its page or in anything it is sent; End class
// ends the session over the host's connection. Pictures go to screenshots/ for the design review.
// Built app, fake backend and fake live process on loopback, no network, no real account.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { document as classDocument, ID_A } from "../unit/sync-fixtures.ts";
import { APP_DIR, launch, sleep } from "./launch.ts";
import { LIVE_HOST_TOKEN, LIVE_JOIN_CODE, startLiveBackend } from "./live-backend.ts";
import type { FakeLive } from "./live-backend.ts";
import { onPage, theRoom, waitFor, windowCount } from "./room-helpers.ts";

const SHOTS = join(APP_DIR, "screenshots");
const T = { timeout: 90_000 };
const CONTROL_CODE = "QRST-VWXZ";
let server: Server;
let live: FakeLive;
let app: ElectronApplication;
let page: Page;

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  let origin: string;
  ({ server, origin, live } = await startLiveBackend(classDocument("Room remote")));
  ({ app, page } = await launch({ page: "list", args: ["--test-memory-keychain"], env: { PLAYER_BACKEND_ORIGIN: origin } }));
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => undefined;
  });
}, T);
after(async () => {
  await app?.close();
  server?.closeAllConnections();
  server?.close();
}, T);

/** Every phone-remote slot the shell sends the room window, recorded in the room page as it arrives. */
async function recordSlots(room: Page): Promise<void> {
  await room.evaluate(() => {
    const w = window as unknown as { room: { onRemote(cb: (v: unknown) => void): void }; __slots: string[] };
    w.__slots = [];
    w.room.onRemote((v) => void w.__slots.push(JSON.stringify(v)));
  });
}
const slots = (room: Page): Promise<string[]> => room.evaluate(() => (window as unknown as { __slots: string[] }).__slots);
const bandText = (room: Page): Promise<string> => room.evaluate(() => document.querySelector(".band")?.textContent ?? "");
const showBand = async (room: Page): Promise<void> => {
  await room.mouse.move(400, 300);
  await room.mouse.move(420, 310);
};

test("Phone remote on the room screen starts the live session; the room shows the class code and never the host token or a control code", T, async () => {
  await page.waitForSelector('#app[data-body="not-paired"]');
  await page.locator('[data-action="pair"]').first().click();
  await page.waitForSelector(`#list [data-id="${ID_A}"]`, { timeout: 30_000 });
  await page.locator('footer [data-action="start"]').click();
  await onPage(page, "presenter.html");
  const room = await theRoom(app);
  await room.waitForSelector(".band");
  await recordSlots(room);
  await showBand(room);

  // Paired, a class open, the room window up: nothing has started the phone remote.
  await room.waitForSelector('.band [data-id="remote"]');
  await sleep(1500);
  assert.equal(live.starts, 0, "the phone remote never starts by itself");
  assert.match(await bandText(room), /Phone remote/);
  await room.screenshot({ path: join(SHOTS, "room-remote-off.png") });

  // The instructor's press.
  await showBand(room);
  await room.locator('.band [data-id="remote"]').click();
  await waitFor(async () => live.hostIn(), 15_000, "the host to be welcomed by the fake live process");
  assert.equal(live.starts, 1);
  assert.ok(live.received.some((m) => m.type === "hello" && m.token === LIVE_HOST_TOKEN), "the host token goes in hello only");
  await showBand(room);
  await room.waitForFunction((c) => document.querySelector(".band .code .v")?.textContent === c, LIVE_JOIN_CODE, { timeout: 10_000 });
  assert.match(await bandText(room), /Class code/);
  // Before the start the join sheet opens by itself (room-join.md): the band's slot says J hides it.
  await room.waitForSelector("section.join", { state: "visible", timeout: 10_000 });
  assert.match(await bandText(room), /J hides the codes/);
  await room.screenshot({ path: join(SHOTS, "room-remote-join-sheet.png") });
  await room.keyboard.press("j");
  await room.waitForSelector("section.join", { state: "hidden", timeout: 10_000 });
  await showBand(room);
  assert.match(await bandText(room), /Phone remote on/);
  await room.screenshot({ path: join(SHOTS, "room-remote-on.png") });

  // The live process issues a control code (as for the presenter with a second display) and a phone joins.
  live.push({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  live.push({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  await showBand(room);
  await room.waitForFunction(() => document.querySelector(".band .code .dt")?.textContent === "Phone connected", undefined, { timeout: 10_000 });
  await room.screenshot({ path: join(SHOTS, "room-remote-phone-connected.png") });

  // Nothing the room window holds or was sent carries the host token or a control code.
  const html = await room.evaluate(() => new XMLSerializer().serializeToString(document));
  const asked = await room.evaluate(() => (window as unknown as { room: { remoteState(): Promise<unknown> } }).room.remoteState().then((v) => JSON.stringify(v)));
  const sent = await slots(room);
  assert.ok(sent.some((s) => s.includes(LIVE_JOIN_CODE)), "the room was sent the join code");
  for (const text of [html, asked, ...sent]) {
    for (const secret of [LIVE_HOST_TOKEN, CONTROL_CODE, CONTROL_CODE.replace("-", ""), "cbp_"]) assert.ok(!text.includes(secret), `${secret} reached the room window`);
  }

  // End, End class: the session ends over the host's connection and the room window closes.
  await room.keyboard.press("End");
  await room.locator('.band [data-id="end-class"]').click();
  await waitFor(async () => live.received.some((m) => m.type === "end"), 10_000, "the end message");
  await waitFor(async () => (await windowCount(app)) === 1, 10_000, "the room window to close");
  assert.equal(live.starts, 1, "one session, started once");
});

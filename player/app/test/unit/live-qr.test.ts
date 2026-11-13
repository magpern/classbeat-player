// The presenter's control-link QR code (#201; ADR 0005 section 3; companion.md, "Getting control"):
// the view's link is exactly the control page, the class code and the control code the panel
// shows, its QR code reads back to it, and it is there exactly while the control code is shown:
// never with one display, gone when the code is used, runs out, is replaced or a Drop ends it,
// and never while not live. Through the real live client over the fake relay. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { LivePanelView } from "../../src/core/live/panel-view.ts";
import { encodeQr } from "../../src/core/qr/qr-encode.ts";
import { MODULE_PX, QUIET, qrPath } from "../../src/renderer/live-qr.ts";
import { REPO } from "./fixtures.ts";
import { CONTROL_CODE, JOIN_CODE, ORIGIN, rig, started } from "./live-relay.ts";
import type { Rig } from "./live-relay.ts";
import { decodeQr } from "./qr-decode.ts";

const EXPECTED = `${ORIGIN}/control#${JOIN_CODE}.${CONTROL_CODE}`;

/** The link as the panel's three shown lines compose it. */
const shown = (v: LivePanelView): string => `${v.controlPage}#${v.classCode}.${v.controlCode}`;

async function withCode(r?: Rig): Promise<Rig> {
  const on = await started(r);
  on.live.makeCode();
  on.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  return on;
}

test("the link is the shown control page, class code and control code, and its QR code reads back to it", async () => {
  const v = (await withCode()).live.view();
  assert.equal(v.controlLink, EXPECTED);
  assert.equal(v.controlLink, shown(v));
  assert.equal(decodeQr(encodeQr(v.controlLink!).rows).text, shown(v));
});

test("one display: no link, no QR code, even when a code arrives", async () => {
  const one = rig();
  one.secondDisplay = false;
  const v = (await withCode(one)).live.view();
  assert.equal(v.controlCode, null);
  assert.equal(v.controlLink, null);
});

test("the link goes when the code is used, cancelled after wrong tries or replaced by none", async () => {
  for (const reason of ["used", "wrong_tries", "expired", "replaced"] as const) {
    const on = await withCode();
    on.socket().server({ v: 1, type: "code_cancelled", reason });
    assert.equal(on.live.view().controlLink, null, reason);
    assert.equal(on.live.view().controlCode, null, reason);
  }
});

test("the link goes when the code runs out on the computer's clock, before the server says so", async () => {
  const on = await withCode();
  await on.advance(119_000);
  assert.equal(on.live.view().controlLink, EXPECTED);
  await on.advance(1000);
  assert.equal(on.live.view().controlLink, null);
  assert.equal(on.live.view().controlCode, null);
});

test("a Drop ends the shown code and its link at once (ADR 0005 section 3)", async () => {
  const on = await withCode();
  on.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "sign_in" });
  assert.equal(on.live.view().controlLink, EXPECTED);
  assert.equal(on.live.drop(1).controlLink, null);
});

test("no link once the session is not live: reconnecting, ended, a new class", async () => {
  const away = await withCode();
  away.socket().drop(1006);
  assert.equal(away.live.view().controlLink, null);
  const ended = await withCode();
  ended.live.end();
  assert.equal(ended.live.view().controlLink, null);
  const changed = await withCode();
  changed.live.classChanged();
  assert.equal(changed.live.view().controlLink, null);
});

test("link and control code come and go together, and the link holds nothing else", async () => {
  const on = await withCode();
  for (let i = 0; i < 6; i++) {
    const v = on.live.view();
    assert.equal(v.controlLink === null, v.controlCode === null, `step ${i}`);
    if (v.controlLink !== null) assert.equal(v.controlLink, shown(v));
    await on.advance(30_000);
  }
});

test("the drawn path is the code's dark modules, one unit square each inside the quiet zone", () => {
  const qr = encodeQr(EXPECTED);
  const squares = [...qrPath(qr.rows).matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]) - QUIET, Number(m[2]) - QUIET]);
  assert.equal(qrPath(qr.rows).replace(/M\d+ \d+h1v1h-1z/g, ""), "");
  const rows = qr.rows.map((r) => r.map(() => false));
  for (const [x, y] of squares) rows[y][x] = true;
  assert.equal(decodeQr(rows).text, EXPECTED);
  assert.ok(QUIET >= 4 && MODULE_PX >= 4);
});

test("the QR code is the presenter's alone: the room's page, preload and script never draw it", () => {
  const app = join(REPO, "player", "app", "src");
  for (const f of [join("renderer", "room.html"), join("renderer", "room.ts"), join("preload", "room-preload.ts")]) {
    const source = readFileSync(join(app, f), "utf8");
    assert.doesNotMatch(source, /live-qr|core\/qr\/|controlLink/, f);
  }
  const presenter = readFileSync(join(app, "renderer", "presenter.html"), "utf8");
  assert.match(presenter, /style-src 'none'/);
  assert.match(presenter, /img-src 'none'/);
  assert.match(presenter, /id="live-qr" hidden/);
});

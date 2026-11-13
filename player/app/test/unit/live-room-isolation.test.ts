// The control code never reaches the room window (ADR 0005 section 3, rule 14): no IPC channel of
// the room's carries it and no frame the room is sent or asks for holds it, so the room page's DOM
// cannot show it. The live panel's channels answer the presenter page only. Fakes only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_ROOM_REMOTE_STATE, CH_ROOM_STATE } from "../../src/core/channels.ts";
import * as channels from "../../src/core/channels.ts";
import { ROOM_CHANNELS } from "../../src/core/ipc-policy.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import { NO_REMOTE } from "../../src/core/room/remote.ts";
import { registerLiveHandlers, LIVE_CHANNELS } from "../../src/main/live/live-handlers.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerRoomHandlers } from "../../src/main/room/room-handlers.ts";
import { CONTROL_CODE, HOST_TOKEN, started } from "./live-relay.ts";
import { REPO } from "./fixtures.ts";

const APP_DIR = join(REPO, "player", "app");

const PRESENTER_URL = "file:///app/dist/presenter.html";
const LIST_URL = "file:///app/dist/classlist.html";
const ROOM_URL = "file:///app/dist/room.html";
const TRUSTED = { presenterId: 7, presenterUrl: PRESENTER_URL, listUrl: LIST_URL };
const ROOM = { roomId: 9, roomUrl: ROOM_URL };
const event = (id: number, url: string, parent: unknown = null): IpcMainInvokeEvent => ({ sender: { id }, senderFrame: { parent, url } }) as unknown as IpcMainInvokeEvent;

async function withCode() {
  const r = await started();
  r.live.makeCode();
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  r.socket().server({ v: 1, type: "controller_joined", slot: 1, via: "code" });
  assert.equal(r.live.view().controlCode, CONTROL_CODE);
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerLiveHandlers(bus, () => TRUSTED, r.live);
  registerRoomHandlers(bus, () => ROOM, r.controller, { endClass: () => undefined, remote: NO_REMOTE });
  return { r, handlers };
}

test("the room window gets null from every live channel; only the presenter page is answered", async () => {
  const { handlers } = await withCode();
  const refused = [event(9, ROOM_URL), event(7, LIST_URL), event(7, PRESENTER_URL, {}), event(7, ROOM_URL), event(8, PRESENTER_URL)];
  for (const ch of LIVE_CHANNELS) {
    for (const e of refused) assert.equal(handlers.get(ch)!(e, 1), null, ch);
  }
  const shown = handlers.get(channels.CH_LIVE_VIEW)!(event(7, PRESENTER_URL), undefined);
  assert.equal((shown as { controlCode: string }).controlCode, CONTROL_CODE);
});

test("what the room window is sent and what it can ask for never holds the control code or the host token", async () => {
  const { r, handlers } = await withCode();
  const seen: string[] = [];
  // The shell sends the room a RoomFrame of every snapshot (main.ts: controller.watch → room.send).
  for (let i = 0; i < 20; i++) {
    await r.advance(100);
    seen.push(JSON.stringify(roomFrameOf(r.controller.snapshot())));
    r.live.tick();
  }
  seen.push(JSON.stringify(handlers.get(CH_ROOM_STATE)!(event(9, ROOM_URL), undefined)));
  seen.push(JSON.stringify(handlers.get(CH_ROOM_REMOTE_STATE)!(event(9, ROOM_URL), undefined)));
  assert.ok(seen.length > 0 && seen.every((s) => s.length > 2));
  for (const s of seen) {
    assert.ok(!s.includes(CONTROL_CODE), "the control code in a room frame");
    assert.ok(!s.includes(CONTROL_CODE.replace("-", "")), "the control code in a room frame");
    assert.ok(!s.includes(HOST_TOKEN), "the host token in a room frame");
  }
});

test("the room's door has no live channel: its preload, its channel list and its page", () => {
  const liveNames = Object.entries(channels).filter(([k]) => k.startsWith("CH_LIVE_"));
  assert.equal(liveNames.length, LIVE_CHANNELS.length);
  for (const [, ch] of liveNames) assert.ok(!ROOM_CHANNELS.includes(ch as string));
  const roomPreload = readFileSync(join(APP_DIR, "src", "preload", "room-preload.ts"), "utf8");
  const roomPage = readFileSync(join(APP_DIR, "src", "renderer", "room.ts"), "utf8");
  for (const source of [roomPreload, roomPage]) {
    assert.ok(!/CH_LIVE_|live:|live-panel|core\/live\//.test(source), "the room's door reaches the live session");
  }
  // The room preload's own channels are the room's (#199), none of them a live channel.
  const used = [...roomPreload.matchAll(/\bCH_[A-Z_]+\b/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(used)].sort(), ["CH_ROOM_COMMAND", "CH_ROOM_END", "CH_ROOM_REMOTE_START", "CH_ROOM_REMOTE_STATE", "CH_ROOM_REMOTE_STOP", "CH_ROOM_REMOTE_UPDATE", "CH_ROOM_STATE", "CH_ROOM_UPDATE"]);
});

test("Drop takes exactly 1 or 2 from the presenter; anything else is not read", async () => {
  const { r, handlers } = await withCode();
  const drop = handlers.get(channels.CH_LIVE_DROP)!;
  for (const raw of [0, 3, "1", 1.5, null, { slot: 1 }]) assert.equal(drop(event(7, PRESENTER_URL), raw), null, String(raw));
  assert.equal(r.live.view().slots[0].text, "Phone 1: steering");
  drop(event(7, PRESENTER_URL), 1);
  assert.equal(r.live.view().slots[0].text, "Phone 1: free");
});

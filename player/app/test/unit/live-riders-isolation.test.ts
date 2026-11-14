// The riders' list reaches the presenter's channel only (ADR 0007 sections 4 and 6; rule 13): no room
// frame, no room channel and no room page holds a nickname; nothing of it is logged, written to the
// console or to disk, and it is gone when the session ends. The riders' handlers take exactly the
// contract's values from the presenter page. Against the live client with a fake socket and clock.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import * as channels from "../../src/core/channels.ts";
import { ROOM_CHANNELS } from "../../src/core/ipc-policy.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import { registerLiveHandlers, LIVE_CHANNELS } from "../../src/main/live/live-handlers.ts";
import { liveRoomRemote } from "../../src/main/live/room-remote.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerRoomHandlers } from "../../src/main/room/room-handlers.ts";
import type { RidersView } from "../../src/core/live/riders-view.ts";
import { JOIN_CODE, started } from "./live-relay.ts";
import { REPO } from "./fixtures.ts";

const APP_DIR = join(REPO, "player", "app");
const PRESENTER_URL = "file:///app/dist/presenter.html";
const ROOM_URL = "file:///app/dist/room.html";
const TRUSTED = { presenterId: 7, presenterUrl: PRESENTER_URL, listUrl: "file:///app/dist/classlist.html" };
const ROOM = { roomId: 9, roomUrl: ROOM_URL };
const event = (id: number, url: string): IpcMainInvokeEvent => ({ sender: { id }, senderFrame: { parent: null, url } }) as unknown as IpcMainInvokeEvent;
const presenter = event(7, PRESENTER_URL);

const NICK = "Zqxvelle";
const NICK_2 = "Brrmwolf";
const RIDER = "AbCdEfGhIjK";
const RIDER_2 = "LmNoPqRsTuV";

async function withRiders() {
  const r = await started();
  r.socket().server({ v: 1, type: "rider_joined", rider: RIDER, nickname: NICK });
  r.socket().server({ v: 1, type: "rider_joined", rider: RIDER_2, nickname: NICK_2 });
  const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
  const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
  registerLiveHandlers(bus, () => TRUSTED, r.live);
  registerRoomHandlers(bus, () => ROOM, r.controller, { endClass: () => undefined, remote: liveRoomRemote(r.live) });
  const call = (ch: string, raw?: unknown): RidersView | null => handlers.get(ch)!(presenter, raw) as RidersView | null;
  return { r, handlers, call };
}

const sentOf = (r: Awaited<ReturnType<typeof started>>, type: string) => r.socket().sent.filter((m) => (m as { type: string }).type === type);

test("the presenter's riders channel has the nicknames; the room window and every other page get null", async () => {
  const { handlers, call } = await withRiders();
  assert.deepEqual(call(channels.CH_LIVE_RIDERS)?.rows.map((x) => x.nickname), [NICK, NICK_2]);
  for (const ch of [channels.CH_LIVE_RIDERS, channels.CH_LIVE_DROP_RIDER, channels.CH_LIVE_LOCK, channels.CH_LIVE_NEW_CODE]) {
    assert.ok(LIVE_CHANNELS.includes(ch));
    assert.ok(!ROOM_CHANNELS.includes(ch));
    for (const e of [event(9, ROOM_URL), event(7, ROOM_URL), event(8, PRESENTER_URL)]) assert.equal(handlers.get(ch)!(e, RIDER), null, ch);
  }
});

test("no room frame, room answer or room slot ever holds a nickname or a rider's id", async () => {
  const { r, handlers } = await withRiders();
  const seen: string[] = [];
  for (let i = 0; i < 20; i++) {
    await r.advance(100);
    r.live.tick();
    seen.push(JSON.stringify(roomFrameOf(r.controller.snapshot())));
  }
  seen.push(JSON.stringify(handlers.get(channels.CH_ROOM_STATE)!(event(9, ROOM_URL), undefined)));
  const slot = handlers.get(channels.CH_ROOM_REMOTE_STATE)!(event(9, ROOM_URL), undefined);
  assert.equal((slot as { joinCode?: string }).joinCode, JOIN_CODE);
  seen.push(JSON.stringify(slot), JSON.stringify(r.live.roomView()), JSON.stringify(r.live.view()));
  for (const s of seen) for (const x of [NICK, NICK_2, RIDER, RIDER_2]) assert.ok(!s.includes(x), `${x} in ${s.slice(0, 80)}`);
});

test("no nickname is logged or written to the console, and the rider_state sent holds no rider", async () => {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    const { r, call } = await withRiders();
    // Bad frames about riders as well: the dropped ones are not logged with their text either.
    r.socket().server({ v: 1, type: "rider_joined", rider: RIDER, nickname: `${NICK}${"x".repeat(30)}` });
    r.socket().server({ v: 1, type: "rider_left", rider: RIDER, reason: "kicked", nickname: NICK });
    call(channels.CH_LIVE_DROP_RIDER, RIDER);
    r.socket().server({ v: 1, type: "rider_left", rider: RIDER, reason: "dropped" });
    for (let i = 0; i < 30; i++) {
      await r.advance(100);
      r.live.tick();
    }
    r.live.end();
    await r.advance(5000);
    const all = [...lines, ...r.logs];
    for (const x of [NICK, NICK_2, RIDER, RIDER_2]) assert.ok(!all.some((l) => l.includes(x)), `${x} logged`);
    const riders = sentOf(r, "rider_state");
    assert.ok(riders.length >= 2);
    for (const m of riders) for (const x of [NICK, NICK_2, RIDER, RIDER_2]) assert.ok(!JSON.stringify(m).includes(x));
  } finally {
    Object.assign(console, orig);
  }
});

test("the list is gone when the session ends", async () => {
  const { r, call } = await withRiders();
  r.live.end();
  await r.advance(5000);
  const v = call(channels.CH_LIVE_RIDERS);
  assert.deepEqual([v?.rows.length, v?.count, v?.on], [0, "–", false]);
  assert.ok(!JSON.stringify(v).includes(NICK));
});

test("Remove, Lock and New code send exactly the contract's messages; anything else is not read", async () => {
  const { r, call } = await withRiders();
  for (const raw of [undefined, null, 1, "short", `${RIDER}x`, "AbCdEfGhI!K", { rider: RIDER }]) assert.equal(call(channels.CH_LIVE_DROP_RIDER, raw), null, String(raw));
  for (const raw of [undefined, null, 1, "true", { locked: true }]) assert.equal(call(channels.CH_LIVE_LOCK, raw), null, String(raw));
  const before = r.socket().sent.length;
  assert.ok(call(channels.CH_LIVE_DROP_RIDER, RIDER) !== null);
  assert.ok(call(channels.CH_LIVE_LOCK, true) !== null);
  assert.ok(call(channels.CH_LIVE_NEW_CODE) !== null);
  await r.advance(1000);
  const ops = r.socket().sent.slice(before).filter((m) => !["companion_state", "rider_state"].includes((m as { type: string }).type));
  assert.deepEqual(ops, [
    { v: 1, type: "drop_rider", rider: RIDER },
    { v: 1, type: "lock", locked: true },
    { v: 1, type: "new_join_code" },
  ]);
  // A Remove for a rider not in the list sends nothing.
  call(channels.CH_LIVE_DROP_RIDER, "ZZZZZZZZZZZ");
  await r.advance(1000);
  assert.equal(sentOf(r, "drop_rider").length, 1);
});

test("the new join code reaches the room's slot at once; the old one is gone from it", async () => {
  const { r, handlers, call } = await withRiders();
  call(channels.CH_LIVE_NEW_CODE);
  r.socket().server({ v: 1, type: "join_code", code: "KXPD-RMTB" });
  const slot = handlers.get(channels.CH_ROOM_REMOTE_STATE)!(event(9, ROOM_URL), undefined);
  assert.equal((slot as { joinCode?: string }).joinCode, "KXPD-RMTB");
  assert.ok(!JSON.stringify(slot).includes(JOIN_CODE));
  assert.equal(call(channels.CH_LIVE_RIDERS)?.line, "New code KXPD-RMTB. The room screen shows it now.");
});

test("no live module writes to disk; no room source reaches the live session or the riders", () => {
  const live = join(APP_DIR, "src", "core", "live");
  const mainLive = join(APP_DIR, "src", "main", "live");
  for (const dir of [live, mainLive]) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const s = readFileSync(join(dir, f), "utf8");
      assert.ok(!/from "node:fs|from "fs|require\("fs|writeFile|appendFile|createWriteStream|localStorage|indexedDB/.test(s), `${f} writes`);
    }
  }
  const room = ["preload/room-preload.ts", "renderer/room.ts", "renderer/room-band.ts", "renderer/room-join.ts", "core/room/join-sheet.ts", "core/room/band-view.ts", "core/room/remote.ts"];
  for (const f of room) {
    const s = readFileSync(join(APP_DIR, "src", f), "utf8");
    assert.ok(!/CH_LIVE_|live:|live-panel|riders-panel|core\/live\/|nickname|rider_joined/.test(s), `${f} reaches the live session or the riders`);
  }
});

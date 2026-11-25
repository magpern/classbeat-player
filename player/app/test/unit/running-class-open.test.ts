// A running class through the player's whole open path (ADR 0015 section 2: every screen shows a
// running class): the valid treadmill example is read, listed, started and framed for the room
// window, and the room screen shows the incline target and never a cadence or a position.
// Fakes only: no music link, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { toRoomModel } from "../../../../web/src/room/adapter.ts";
import type { RoomInput } from "../../../../web/src/room/input.ts";
import { readClassText } from "../../src/core/class-file.ts";
import { metaText } from "../../src/core/list/screen.ts";
import { listRows } from "../../src/core/list/rows.ts";
import { INITIAL as PLAYER, command, openText, snapshotOf } from "../../src/core/player-state.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import { classListView } from "../../src/core/sync/class-list.ts";
import { INITIAL as SYNC } from "../../src/core/sync/sync-model.ts";
import type { SyncState } from "../../src/core/sync/sync-model.ts";
import { classSchema, EXAMPLES } from "./fixtures.ts";

const FILE = "class-running-treadmill.json";
const TEXT = readFileSync(join(EXAMPLES, "valid", FILE), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";

/** The room window's model at `ms` into the class, the way the shell frames it for the window. */
function roomAt(ms: number) {
  const t0 = 1_000;
  let s = openText(PLAYER, FILE, TEXT, classSchema, t0);
  s = command(s, { type: "start" }, t0);
  const frame = roomFrameOf(snapshotOf(s, t0 + ms));
  return toRoomModel({ doc: frame.doc, view: frame.view, link: frame.link, pattern: frame.pattern } as RoomInput);
}

test("the running example opens through the player's reader", () => {
  const r = readClassText(TEXT, classSchema);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.doc.class.sport, "running");
});

test("the class list says Running for it", () => {
  const doc = JSON.parse(TEXT) as Record<string, unknown>;
  const state = { ...SYNC, unread: false, held: new Map([[ID, `sha256:${"1".repeat(64)}`]]), published: new Map() } as SyncState;
  const rows = listRows(classListView(state, new Map([[ID, doc]])), null, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sport, "running");
  assert.equal(rows[0].title, "Treadmill intervals");
  assert.match(metaText(rows[0]), /^Running, /);
});

test("the room model of a running class: the target metric is the incline, with no cadence or position", () => {
  const first = roomAt(60_000);
  assert.equal(first.kind, "running");
  assert.deepEqual(first.metrics[0], { label: "Target", value: "Incline flat", unit: null, incline: true });
  assert.deepEqual(roomAt(400_000).metrics[0], { label: "Target", value: "Incline raised", unit: null, incline: true });
  for (const m of [first, roomAt(400_000)]) {
    const labels = m.metrics.map((x) => x.label.toLowerCase());
    assert.ok(!labels.includes("cadence") && !labels.includes("position"), labels.join());
  }
});

test("the next row shows the incline, with no cadence or seated/standing position", () => {
  const next = roomAt(60_000).next;
  assert.ok(next && !next.end);
  assert.equal(next.zone, 3);
  assert.equal(next.cadence, null);
  assert.equal(next.position, "Incline raised");
});

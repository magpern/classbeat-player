// What the shell sends the class list window and what Start does (main/list/list-controller.ts),
// against a fake sync: the rows are read only when sync says the list changed, a refused pin
// starts nothing and refreshes the list, and the class being played stays on the list as a
// snapshot (title and length, in memory) when its cached copy is removed, until it ends.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { EMPTY_SNAPSHOT } from "../../src/core/snapshot.ts";
import type { PairingView } from "../../src/core/pairing/view.ts";
import type { ClassRow } from "../../src/core/sync/class-list.ts";
import type { SyncView } from "../../src/core/sync/view.ts";
import { createListController } from "../../src/main/list/list-controller.ts";
import { PAIRED, row, SYNCED } from "./list-fixtures.ts";

const OPENED = { ...EMPTY_SNAPSHOT, loadId: 1, doc: { class: {} } } as unknown as Snapshot;
const BAD = { ...EMPTY_SNAPSHOT, error: { message: "This class file is not valid.", details: [] } } as Snapshot;

function rig() {
  const r = {
    rows: [row("Alpha", 1), row("Bravo", 2), row("Charlie", 3)] as ClassRow[],
    sync: { ...SYNCED, classes: 3 } as SyncView,
    pairing: PAIRED as PairingView,
    listed: 0,
    pins: [] as [string, string | undefined][],
    unpins: 0,
    pinResult: {} as Record<string, unknown> | null,
    opened: [] as [string, string][],
    openResult: OPENED,
    listener: (): void => undefined,
  };
  const controller = createListController({
    sync: {
      view: () => r.sync,
      list: () => (r.listed++, r.rows),
      pin: (id, hash) => (r.pins.push([id, hash]), r.pinResult),
      unpin: () => void r.unpins++,
      watch: (l) => void (r.listener = l),
    },
    pairing: { view: () => r.pairing },
    open: (name, text) => (r.opened.push([name, text]), r.openResult),
  });
  return { r, controller };
}

test("the rows are read again only when sync says the list changed, or the pairing did, never on each paint", () => {
  const { r, controller } = rig();
  for (let i = 0; i < 20; i++) controller.view();
  assert.equal(r.listed, 1);
  r.sync = { ...r.sync, status: "syncing" };
  controller.view();
  assert.equal(r.listed, 1, "a status that changed is not a reason to read the classes");
  r.listener();
  controller.view();
  controller.view();
  assert.equal(r.listed, 2);
  r.pairing = { ...PAIRED, email: "bob@example.com" };
  controller.view();
  assert.equal(r.listed, 3, "another account");
  r.pairing = { state: "waiting", userCode: "AAAA-BBBB", page: "https://p.example/pair", secondsLeft: 500 };
  controller.view();
  r.pairing = { state: "waiting", userCode: "AAAA-BBBB", page: "https://p.example/pair", secondsLeft: 499 };
  controller.view();
  assert.equal(r.listed, 4, "a countdown is not a reason either");
});

test("Start pins the id and hash the instructor saw, opens the class, and nothing else changes", () => {
  const { r, controller } = rig();
  controller.view();
  r.pinResult = { class: { title: "Bravo" } };
  assert.equal(controller.start(r.rows[1].id, r.rows[1].hash), true);
  assert.deepEqual(r.pins, [[r.rows[1].id, r.rows[1].hash]]);
  assert.equal(r.opened.length, 1);
  assert.equal(r.opened[0][0], "Bravo");
  assert.deepEqual(JSON.parse(r.opened[0][1]), r.pinResult);
});

test("a refused pin starts nothing, refreshes the list and shows the row as it now is", () => {
  const { r, controller } = rig();
  controller.view();
  const old = r.rows[1];
  // The class changed in between: sync refuses the old hash, and the next list has the new version.
  r.pinResult = null;
  r.rows = [r.rows[0], { ...old, hash: `sha256:${"f".repeat(64)}`, title: "Bravo, new" }, r.rows[2]];
  assert.equal(controller.start(old.id, old.hash), false);
  assert.equal(r.opened.length, 0, "nothing opened");
  assert.equal(r.unpins, 0);
  const shown = controller.view().rows.find((x) => x.id === old.id);
  assert.equal(shown?.title, "Bravo, new");
  assert.equal(r.listed, 2);
  // An id and hash the list never showed is not even offered to sync.
  r.pins = [];
  assert.equal(controller.start("99999999-0000-4000-8000-000000000000", "sha256:x"), false);
  assert.deepEqual(r.pins, []);
});

test("a class that does not open after the pin is let go: nothing is pinned, nothing starts", () => {
  const { r, controller } = rig();
  controller.view();
  r.pinResult = { broken: true };
  r.openResult = BAD;
  assert.equal(controller.start(r.rows[0].id, r.rows[0].hash), false);
  assert.equal(r.unpins, 1);
});

test("while the pinned class has no cached copy, its snapshot stands in its place, until the class ends", () => {
  const { r, controller } = rig();
  controller.view();
  const played = r.rows[1];
  r.pinResult = {};
  assert.equal(controller.start(played.id, played.hash), true);
  // Sync now holds no copy: the server removed the class.
  r.rows = [r.rows[0], r.rows[2]];
  r.sync = { ...r.sync, classes: 2, pinned: { id: played.id, after: "removed" } };
  r.listener();
  const shown = controller.view().rows;
  assert.deepEqual(shown.map((x) => [x.title, x.removed, x.playing]), [["Alpha", false, false], ["Bravo", true, true], ["Charlie", false, false]]);
  assert.equal(shown[1].lengthMs, played.lengthMs);
  assert.equal(shown[1].hash, played.hash);
  // The class ends: the snapshot is dropped, and does not come back.
  r.sync = { ...r.sync, pinned: null };
  r.listener();
  assert.deepEqual(controller.view().rows.map((x) => x.title), ["Alpha", "Charlie"]);
  r.sync = { ...r.sync, pinned: { id: played.id, after: "removed" } };
  assert.deepEqual(controller.view().rows.map((x) => x.title), ["Alpha", "Charlie"], "no snapshot is kept after the end");
});

test("the window gets the file error until it is closed, and a start clears it", () => {
  const { r, controller } = rig();
  controller.fileFailed({ message: "This class file is not valid.", fileName: "x.json", details: ["a"] });
  assert.equal(controller.view().fileError?.fileName, "x.json");
  controller.dismissFileError();
  assert.equal(controller.view().fileError, null);
  controller.fileFailed({ message: "m", fileName: "y.json", details: [] });
  controller.view();
  r.pinResult = {};
  assert.equal(controller.start(r.rows[0].id, r.rows[0].hash), true);
  assert.equal(controller.view().fileError, null);
});

test("the view holds only the fields of a view: no token, no document, no account key", () => {
  const { r, controller } = rig();
  r.pinResult = { class: { title: "secret document body" } };
  controller.view();
  controller.start(r.rows[0].id, r.rows[0].hash);
  const text = JSON.stringify(controller.view());
  assert.doesNotMatch(text, /secret document body|cbp_|token|account/);
});

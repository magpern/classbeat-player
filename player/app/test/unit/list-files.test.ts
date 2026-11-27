// The class list controller with the music files state (#922): a local class is listed with its files
// view, its Start waits while a check or search runs, and nothing is asked while a class is played.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FilesView } from "../../src/core/music-files/files-view.ts";
import { EMPTY_SNAPSHOT } from "../../src/core/snapshot.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import type { ClassRow } from "../../src/core/sync/class-list.ts";
import { createListController } from "../../src/main/list/list-controller.ts";
import { MIX_DISABLED } from "../../src/core/mix/view.ts";
import { PAIRED, row, SYNCED } from "./list-fixtures.ts";

const OPENED = { ...EMPTY_SNAPSHOT, loadId: 1, doc: { class: {} } } as unknown as Snapshot;

function rig() {
  const r = {
    rows: [row("Alpha", 1), row("Local", 2, { source: "local", songs: 3 })] as ClassRow[],
    pinned: null as { id: string; after: string } | null,
    held: false,
    views: 0,
    resets: 0,
    pins: 0,
    account: "a".repeat(64),
  };
  const files: FilesView = { id: r.rows[1]!.id, hash: r.rows[1]!.hash, phase: "idle", held: false, total: 3, missing: [], searched: false, failed: false };
  const controller = createListController({
    sync: { view: () => ({ ...SYNCED, classes: 2, pinned: r.pinned as never }), list: () => r.rows, pin: () => (r.pins++, {}), unpin: () => void (r.pinned = null), watch: () => undefined },
    pairing: { view: () => PAIRED },
    account: () => r.account,
    open: () => OPENED,
    mix: () => MIX_DISABLED,
    files: { view: (rows) => (r.views++, rows.filter((x) => x.source === "local").map(() => files)), held: () => r.held, reset: () => void r.resets++ },
  });
  return { r, controller, files };
}

test("the view carries the files state of the local classes, and none for a list without any", () => {
  const { controller, files } = rig();
  assert.deepEqual(controller.view().files, [files]);
  const bare = createListController({ sync: { view: () => ({ ...SYNCED }), list: () => [row("Alpha", 1)], pin: () => ({}), unpin: () => undefined, watch: () => undefined }, pairing: { view: () => PAIRED }, account: () => null, open: () => OPENED, mix: () => MIX_DISABLED });
  assert.deepEqual(bare.view().files, []);
});

test("Start of a local class waits while its files are being checked or searched; other classes are not held", () => {
  const { r, controller } = rig();
  controller.view();
  r.held = true;
  assert.equal(controller.start(r.rows[1]!.id, r.rows[1]!.hash), false);
  assert.equal(r.pins, 0, "nothing was pinned");
  assert.equal(controller.start(r.rows[0]!.id, r.rows[0]!.hash), true, "a Spotify class does not wait");
  r.held = false;
  controller.release();
  assert.equal(controller.start(r.rows[1]!.id, r.rows[1]!.hash), true);
});

test("nothing is asked of the files while a class is played, and the answers are dropped when it ends or the account changes", () => {
  const { r, controller } = rig();
  controller.view();
  const before = r.views;
  const resets = r.resets;
  r.pinned = { id: r.rows[0]!.id, after: "same" };
  assert.deepEqual(controller.view().files, []);
  assert.equal(r.views, before, "no check is started under a running class");
  controller.release();
  assert.equal(r.resets, resets + 1, "a class ended");
  r.account = "b".repeat(64);
  controller.view();
  assert.equal(r.resets, resets + 2, "another account");
});

// Finding a class's songs among the instructor's files (main/music-files/; ADR 0017 section 2,
// #920), on real temporary folders: by size and SHA-256 only, never a name, tags or a date; a
// changed or missing file leaves the index; no symbolic link is followed; the entry limit; cancel
// keeps nothing; the index is the account's and is wiped when the pairing is forgotten.
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { EMPTY_INDEX } from "../../src/core/music-files/index-model.ts";
import { indexStore } from "../../src/main/music-files/index-store.ts";
import { matchFiles } from "../../src/main/music-files/matcher.ts";
import { ACCT, CLASS_ID, bytes, localClass, musicRig, sha } from "./music-files-fakes.ts";
import type { Rig } from "./music-files-fakes.ts";

const POSIX = process.platform !== "win32";
let rigs: Rig[] = [];
const rig = (max?: number): Rig => {
  const r = musicRig(max);
  rigs.push(r);
  return r;
};
afterEach(() => {
  for (const r of rigs) r.done();
  rigs = [];
});
const indexed = (r: Rig) => indexStore(r.indexDir).load(ACCT);

test("a renamed, retagged file with a changed date is found by its content; a file with the class's name but other bytes is not", async () => {
  const r = rig();
  const a = bytes("a", 4000);
  const b = bytes("b", 5000);
  r.doc = localClass([a, b], ["Intro.mp3", "Climb.mp3"]);
  const moved = r.put("renamed/whatever.ogg", a);
  utimesSync(moved, new Date("2001-01-01"), new Date("2001-01-01"));
  r.put("Climb.mp3", bytes("x", 5000));
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "done", songs: ["found", "missing"], limit_reached: false });
  assert.equal(r.dialogs, 1);
  const idx = indexed(r);
  assert.deepEqual(idx.folders, [r.music]);
  assert.deepEqual([...idx.files.keys()], [sha(a)]);
  assert.equal(idx.files.get(sha(a))!.path, moved);
});

test("the index is this user's only, and a second find uses it without searching again", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  r.put("a.flac", a);
  await r.service.find(CLASS_ID);
  if (POSIX) {
    assert.equal(statSync(r.indexDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(r.indexDir, `${ACCT}.json`)).mode & 0o777, 0o600);
  }
  // The second find picks an empty folder: the song is still found, from the checked index.
  r.folder = join(r.root, "data");
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "done", songs: ["found"], limit_reached: false });
});

test("a changed or missing file is dropped from the index and is missing", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  const b = bytes("b", 2000);
  r.doc = localClass([a, b]);
  const pa = r.put("a.mp3", a);
  const pb = r.put("b.mp3", b);
  await r.service.find(CLASS_ID);
  assert.equal(indexed(r).files.size, 2);
  // Same size, other bytes, a later time: hashed again and dropped. The other is deleted.
  writeFileSync(pa, bytes("z", 1000));
  utimesSync(pa, new Date("2030-01-01"), new Date("2030-01-01"));
  unlinkSync(pb);
  assert.deepEqual(await r.service.check(CLASS_ID), { status: "done", songs: ["missing", "missing"], limit_reached: false });
  assert.equal(indexed(r).files.size, 0);
});

test("a file moved within a chosen folder is found again by the check before playing", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  const pa = r.put("a.mp3", a);
  await r.service.find(CLASS_ID);
  const moved = join(r.music, "moved.mp3");
  renameSync(pa, moved);
  assert.deepEqual(await r.service.check(CLASS_ID), { status: "done", songs: ["found"], limit_reached: false });
  assert.equal(indexed(r).files.get(sha(a))!.path, moved);
  assert.equal(r.dialogs, 1, "the check opens no dialog");
});

test("no symbolic link is followed, to a file or to a folder", { skip: !POSIX }, async () => {
  const r = rig();
  const a = bytes("a", 1000);
  const b = bytes("b", 2000);
  r.doc = localClass([a, b]);
  const outside = join(r.root, "outside");
  writeFileSync(join(r.root, "a.mp3"), a);
  symlinkSync(join(r.root, "a.mp3"), join(r.music, "link.mp3"));
  r.put("../outside/b.mp3", b);
  symlinkSync(outside, join(r.music, "linked-folder"));
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "done", songs: ["missing", "missing"], limit_reached: false });
  assert.equal(indexed(r).files.size, 0);
});

test("an indexed path that became a symbolic link is dropped", { skip: !POSIX }, async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  const pa = r.put("a.mp3", a);
  await r.service.find(CLASS_ID);
  const real = join(r.root, "real.mp3");
  writeFileSync(real, a);
  unlinkSync(pa);
  symlinkSync(real, pa);
  r.folder = join(r.root, "data");
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "done", songs: ["missing"], limit_reached: false });
  assert.equal(indexed(r).files.size, 0);
});

test("the entry limit stops the walk and says so with one boolean", async () => {
  const a = bytes("a", 1000);
  const b = bytes("b", 2000);
  for (const [max, reached] of [[3, true], [undefined, false]] as const) {
    const r = rig(max);
    r.doc = localClass([a, b]);
    for (let i = 0; i < 10; i++) r.put(`junk/${i}.txt`, bytes("j", 10 + i));
    const answer = await r.service.find(CLASS_ID);
    assert.ok(answer !== null && answer.status === "done");
    assert.equal(answer.limit_reached, reached);
    assert.deepEqual(Object.keys(answer).sort(), ["limit_reached", "songs", "status"]);
  }
});

test("a find cancelled while the dialog is open answers cancelled and keeps nothing", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  r.put("a.mp3", a);
  let open!: () => void;
  r.dialogGate = new Promise((res) => (open = res));
  const finding = r.service.find(CLASS_ID);
  await new Promise((res) => setImmediate(res));
  assert.equal(await r.service.find(CLASS_ID), null, "one find at a time");
  assert.equal(r.service.cancel(), true);
  assert.equal(r.service.cancel(), false, "already cancelled");
  open();
  assert.deepEqual(await finding, { status: "cancelled" });
  assert.ok(!existsSync(r.indexDir));
  assert.equal(r.service.cancel(), false, "nothing runs");
});

test("a check stopped by cancel lets the next check run at once, not busy; the stopped one keeps nothing", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  r.put("a.mp3", a);
  const first = r.service.checkOpen(r.doc);
  assert.equal(r.service.cancel(), true);
  const second = r.service.checkOpen(r.doc);
  assert.notEqual(await second, null, "the next class's first check is not busy");
  assert.deepEqual(await first, { status: "cancelled" });
});

test("a find cancelled with its dialog open still holds the service: a find or a check answers busy until the dialog returns", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  r.put("a.mp3", a);
  let open!: () => void;
  r.dialogGate = new Promise((res) => (open = res));
  const finding = r.service.find(CLASS_ID);
  await new Promise((res) => setImmediate(res));
  assert.equal(r.service.cancel(), true);
  assert.equal(await r.service.find(CLASS_ID), null, "no second folder dialog");
  assert.equal(r.dialogs, 1);
  assert.equal(await r.service.checkOpen(r.doc), null, "no check beside the open dialog");
  open();
  assert.deepEqual(await finding, { status: "cancelled" });
  assert.notEqual(await r.service.checkOpen(r.doc), null, "free once the dialog has returned");
});

test("a released stopped check that unwinds does not free the service under the check that replaced it", async () => {
  const r = rig();
  // Many indexed songs, so a check awaits many file reads and the second is still running when the first has unwound.
  const songs = Array.from({ length: 200 }, (_, i) => bytes(String.fromCharCode(97 + (i % 26)), 1000 + i));
  r.doc = localClass(songs);
  songs.forEach((b, i) => r.put(`s${i}.mp3`, b));
  assert.equal((await r.service.find(CLASS_ID))?.status, "done");
  const first = r.service.checkOpen(r.doc);
  assert.equal(r.service.cancel(), true);
  const second = r.service.checkOpen(r.doc);
  assert.deepEqual(await first, { status: "cancelled" });
  assert.equal(await r.service.checkOpen(r.doc), null, "the second check still runs: a third is busy");
  assert.notEqual(await second, null);
});

test("a match stopped part way answers nothing and changes nothing", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.put("one/a.mp3", a);
  r.put("two/b.mp3", bytes("b", 1000));
  let calls = 0;
  const m = await matchFiles([{ sha256: sha(a), size: 1000 }, { sha256: "f".repeat(64), size: 1000 }], EMPTY_INDEX, [r.music], 100, () => ++calls > 4);
  assert.equal(m, null);
});

test("a dialog closed without a choice answers cancelled; a class without local files fails before any dialog", async () => {
  const r = rig();
  r.doc = localClass([bytes("a", 10)]);
  r.folder = null;
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "cancelled" });
  r.doc = { music: { source: "spotify" }, songs: [] };
  const dialogs = r.dialogs;
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "failed" });
  assert.deepEqual(await r.service.find("00000000-0000-4000-8000-000000000000"), { status: "failed" });
  r.account = null;
  r.doc = localClass([bytes("a", 10)]);
  assert.deepEqual(await r.service.find(CLASS_ID), { status: "failed" });
  assert.equal(r.dialogs, dialogs);
});

test("the pairing forgotten during a find: the find keeps nothing, and every index is wiped", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  r.put("a.mp3", a);
  await r.service.find(CLASS_ID);
  assert.ok(existsSync(r.indexDir));
  let open!: () => void;
  r.dialogGate = new Promise((res) => (open = res));
  const finding = r.service.find(CLASS_ID);
  await new Promise((res) => setImmediate(res));
  r.service.wipe();
  assert.ok(!existsSync(r.indexDir));
  open();
  assert.deepEqual(await finding, { status: "cancelled" });
  assert.ok(!existsSync(r.indexDir));
});

test("another account paired during a find keeps nothing, and never reads the first account's index", async () => {
  const r = rig();
  const a = bytes("a", 1000);
  r.doc = localClass([a]);
  r.put("a.mp3", a);
  let open!: () => void;
  r.dialogGate = new Promise((res) => (open = res));
  const finding = r.service.find(CLASS_ID);
  await new Promise((res) => setImmediate(res));
  r.account = "d".repeat(64);
  open();
  assert.deepEqual(await finding, { status: "cancelled" });
  assert.ok(!existsSync(r.indexDir));
  r.dialogGate = null;
  r.account = ACCT;
  await r.service.find(CLASS_ID);
  assert.equal(indexStore(r.indexDir).load("d".repeat(64)).files.size, 0);
  assert.ok(readFileSync(join(r.indexDir, `${ACCT}.json`), "utf8").includes(ACCT));
});

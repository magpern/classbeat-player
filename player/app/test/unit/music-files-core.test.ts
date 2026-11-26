// The pure core of local music file finding (core/music-files/; ADR 0017 section 2, #920): what a
// class wants (never its file name), the answer's exact shape, the index file's strict form and
// the check of an indexed file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CANCELLED, FAILED, MAX_FILES, doneAnswer } from "../../src/core/music-files/answer.ts";
import { checkStep } from "../../src/core/music-files/check-policy.ts";
import { EMPTY_INDEX, MAX_FOLDERS, parseIndex, rememberFolder, sameIndex, serializeIndex } from "../../src/core/music-files/index-model.ts";
import { missingOf, wantedFiles } from "../../src/core/music-files/wanted.ts";
import { REPO } from "./fixtures.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const ACCT = "c".repeat(64);
const song = (sha256: string, size: number, file_name = "x.mp3") => ({ title: "t", ids: { local_file: { sha256, size_bytes: size, file_name } } });
const doc = (...songs: unknown[]) => ({ music: { source: "local" }, songs });

test("the example class with local files gives every song's hash and size, in song order", () => {
  const example = JSON.parse(readFileSync(join(REPO, "schema", "class-format", "v1", "examples", "valid", "class-local-files.json"), "utf8"));
  const wanted = wantedFiles(example);
  assert.ok(wanted !== null);
  assert.equal(wanted.length, example.songs.length);
  assert.deepEqual(wanted[0], { sha256: example.songs[0].ids.local_file.sha256, size: example.songs[0].ids.local_file.size_bytes });
});

test("the file name is never read: only the hash and the size are taken", () => {
  let read = 0;
  const lf = new Proxy({ sha256: A, size_bytes: 10, file_name: "SENTINEL.mp3" }, { get: (t, k) => (k === "file_name" && read++, Reflect.get(t, k)) });
  assert.deepEqual(wantedFiles(doc({ ids: { local_file: lf } })), [{ sha256: A, size: 10 }]);
  assert.equal(read, 0);
});

test("any other class, or a song without exactly a file, wants nothing", () => {
  for (const d of [null, {}, { music: { source: "spotify" }, songs: [song(A, 1)] }, doc(), doc(song(A, 1), {}), doc(song("A".repeat(64), 1)), doc(song(A, 0)), doc(song(A, 1.5)), doc(song(A, -1)), doc(song(A.slice(1), 1)), doc({ ids: { local_file: [A, 1] } })]) {
    assert.equal(wantedFiles(d), null);
  }
  assert.equal(wantedFiles({ music: { source: "local" }, songs: Array.from({ length: 1001 }, () => song(A, 1)) }), null);
});

test("missing: the hashes not found, with their sizes", () => {
  const w = wantedFiles(doc(song(A, 3), song(B, 4)))!;
  assert.deepEqual([...missingOf(w, new Set([A]))], [[B, 4]]);
});

test("the answer holds per song found or missing and the limit boolean, and nothing else", () => {
  const w = wantedFiles(doc(song(A, 3), song(B, 4), song(A, 3)))!;
  const a = doneAnswer(w, new Set([A]), true);
  assert.deepEqual(a, { status: "done", songs: ["found", "missing", "found"], limit_reached: true });
  assert.deepEqual(Object.keys(a).sort(), ["limit_reached", "songs", "status"]);
  assert.deepEqual(CANCELLED, { status: "cancelled" });
  assert.deepEqual(FAILED, { status: "failed" });
  assert.equal(MAX_FILES, 20_000);
  assert.ok(!JSON.stringify(a).includes(A));
});

test("the index file reads back only as exactly its form, for its own account", () => {
  const index = { folders: ["/m/one", "/m/two"], files: new Map([[A, { path: "/m/one/a.mp3", size: 3, mtimeMs: 12.5 }]]) };
  const text = serializeIndex(index, ACCT);
  const back = parseIndex(JSON.parse(text), ACCT);
  assert.ok(sameIndex(back, index));
  assert.equal(parseIndex(JSON.parse(text), "d".repeat(64)), EMPTY_INDEX, "another account's index is not read");
  const good = JSON.parse(text);
  const bad = [
    { ...good, v: 2 },
    { ...good, extra: 1 },
    { ...good, folders: "x" },
    { ...good, folders: Array.from({ length: MAX_FOLDERS + 1 }, (_, i) => `/f${i}`) },
    { ...good, folders: ["/a\u0000b"] },
    { ...good, files: { [A.toUpperCase()]: good.files[A] } },
    { ...good, files: { [A]: { ...good.files[A], size: 0 } } },
    { ...good, files: { [A]: { ...good.files[A], path: "" } } },
    { ...good, files: { [A]: { ...good.files[A], extra: 1 } } },
    [],
    null,
  ];
  for (const b of bad) assert.equal(parseIndex(b, ACCT), EMPTY_INDEX);
  assert.throws(() => serializeIndex(index, "../x"));
});

test("a chosen folder goes first, once, and the oldest beyond the cap is forgotten", () => {
  let i = rememberFolder(EMPTY_INDEX, "/a");
  i = rememberFolder(i, "/b");
  i = rememberFolder(i, "/a");
  assert.deepEqual(i.folders, ["/a", "/b"]);
  for (let n = 0; n < 20; n++) i = rememberFolder(i, `/f${n}`);
  assert.equal(i.folders.length, MAX_FOLDERS);
  assert.equal(i.folders[0], "/f19");
});

test("an indexed file is kept only as the same plain file; a changed time is hashed again; anything else is dropped", () => {
  const f = { path: "/m/a.mp3", size: 10, mtimeMs: 5 };
  assert.equal(checkStep(f, 10, { plain: true, size: 10, mtimeMs: 5 }), "keep");
  assert.equal(checkStep(f, 10, { plain: true, size: 10, mtimeMs: 6 }), "rehash");
  assert.equal(checkStep(f, 10, null), "drop");
  assert.equal(checkStep(f, 10, { plain: false, size: 10, mtimeMs: 5 }), "drop");
  assert.equal(checkStep(f, 10, { plain: true, size: 11, mtimeMs: 5 }), "drop");
  assert.equal(checkStep(f, 11, { plain: true, size: 10, mtimeMs: 5 }), "drop");
});

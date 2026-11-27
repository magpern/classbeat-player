// What the class list may know of a local class's files (core/music-files/files-view.ts): only the
// class document's own words for the songs whose file is missing, neutralised, and nothing from the
// disk. Acceptance criterion 2 of #922: only `file_name` from the class document, never a path.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FindAnswer } from "../../src/core/music-files/answer.ts";
import { filesViewOf } from "../../src/core/music-files/files-view.ts";
import type { FilesInput } from "../../src/core/music-files/files-view.ts";
import { MONGOLIAN_VOWEL_SEPARATOR, REPLACEMENT, safeText } from "../../src/core/music-files/safe-text.ts";

const HASH = (k: number): string => String(k).repeat(64);
const song = (k: number, over: Record<string, unknown> = {}) => ({ title: `Song ${k}`, artist: `Artist ${k}`, start_ms: k * 1000, ids: { local_file: { sha256: HASH(k), size_bytes: 1000 + k, file_name: `file ${k}.mp3` } }, ...over });
const DOC = { music: { source: "local" }, songs: [song(1), song(2), song(3)] };
const done = (...s: Array<"found" | "missing">): FindAnswer => ({ status: "done", songs: s, limit_reached: false });
const input = (over: Partial<FilesInput> = {}): FilesInput => ({ id: "c1", hash: "sha256:x", doc: DOC, answer: done("found", "missing", "missing"), phase: "idle", held: false, searched: false, failed: false, ...over });

test("a song is listed as missing, with the class document's title, artist and file name, only when its file is not found", () => {
  const v = filesViewOf(input())!;
  assert.equal(v.total, 3);
  assert.deepEqual(v.missing, [
    { title: "Song 2", artist: "Artist 2", fileName: "file 2.mp3" },
    { title: "Song 3", artist: "Artist 3", fileName: "file 3.mp3" },
  ]);
});

test("every song found: nothing is missing, and the found files are never named", () => {
  const v = filesViewOf(input({ answer: done("found", "found", "found") }))!;
  assert.deepEqual(v.missing, []);
  const text = JSON.stringify(v);
  assert.ok(!text.includes("file 1.mp3") && !text.includes("Song 1"), "a found file is not named");
});

test("an answer that is not done, or has another song count, counts every song as missing", () => {
  for (const answer of [null, { status: "failed" } as FindAnswer, { status: "cancelled" } as FindAnswer, done("found"), done("found", "found", "found", "found")]) {
    assert.equal(filesViewOf(input({ answer }))!.missing.length, 3);
  }
});

test("the view holds only the fields of the spec: no hash, no size, no path, no folder", () => {
  const v = filesViewOf(input({ answer: done("missing", "missing", "missing") }))!;
  assert.deepEqual(Object.keys(v).sort(), ["failed", "hash", "held", "id", "missing", "phase", "searched", "total"]);
  for (const m of v.missing) assert.deepEqual(Object.keys(m).sort(), ["artist", "fileName", "title"]);
  const text = JSON.stringify(v);
  for (const k of [1, 2, 3]) assert.ok(!text.includes(HASH(k)), "no hash");
  assert.ok(!/size_bytes|sha256|1001|1002|\/|\\\\/.test(text.replace("sha256:x", "")), "no size and no path separator");
});

/** Characters made from code points, so no invisible character is written in this file. */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
/** NUL, tab, line feed, DEL, a C1 control, the bidi override and isolate marks, the line and paragraph separators, a zero-width space and the BOM. */
const NASTY = [0x00, 0x09, 0x0a, 0x0d, 0x7f, 0x85, 0x061c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff, 0x034f, 6158, 0xfff9, 0xfffa, 0xfffb, 0xe0000, 0xe0020, 0xe007f];

test("control and bidirectional characters in the class document's words are neutralised, as plain text", () => {
  const evil = `evil${cp(0x00, 0x0a, 0x0d, 0x09, 0x202e)}gnp.exe${cp(0x202c, 0x2066)}x${cp(0x2069, 0x200f, 0x061c, 0x2028, 0x85, 0x7f, 0xfeff)}.mp3`;
  const doc = { music: { source: "local" }, songs: [song(1, { title: `T${cp(0x202e)}itle${cp(0x07)}`, artist: `A${cp(0x2029)}rtist`, ids: { local_file: { sha256: HASH(1), size_bytes: 1, file_name: evil } } })] };
  const v = filesViewOf(input({ doc, answer: done("missing") }))!;
  const m = v.missing[0]!;
  for (const text of [m.fileName, m.title, m.artist]) for (const code of [...NASTY, 0x07]) assert.ok(!text.includes(cp(code)), `U+${code.toString(16)} is gone`);
  assert.ok(m.fileName.includes(REPLACEMENT) && m.fileName.startsWith("evil") && m.fileName.endsWith(".mp3"));
  assert.ok(m.fileName.includes("gnp.exe") && m.title.startsWith("T") && m.title.includes("itle"), "the visible letters stay");
});

test("the Mongolian vowel separator has a named constant, and it is replaced (#955)", () => {
  assert.equal(String.fromCodePoint(MONGOLIAN_VOWEL_SEPARATOR), "\u180e");
  assert.equal(safeText(`a${String.fromCodePoint(MONGOLIAN_VOWEL_SEPARATOR)}b`), `a${REPLACEMENT}b`);
});

test("safeText leaves ordinary text, accents and emoji alone, and replaces each unsafe character", () => {
  const ok = `Sjung, ${cp(0xc4)}lvsbyn ${cp(0x2013)} 07 Pulse Theory (radio edit).flac ${cp(0x1f6b4)}`;
  assert.equal(safeText(ok), ok);
  assert.equal(safeText(`a${cp(0)}b`), `a${REPLACEMENT}b`);
  for (const code of NASTY) assert.equal(safeText(cp(code)), REPLACEMENT, `U+${code.toString(16)}`);
});

test("a document without songs, or with a song that is not an object, gives no view or empty words", () => {
  assert.equal(filesViewOf(input({ doc: null })), null);
  assert.equal(filesViewOf(input({ doc: { songs: [] } })), null);
  const v = filesViewOf(input({ doc: { songs: [null, { title: 5 }] }, answer: null }))!;
  assert.deepEqual(v.missing, [{ title: "", artist: "", fileName: "" }, { title: "", artist: "", fileName: "" }]);
});

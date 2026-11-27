// The presenter's music files notice (core/music-files/music-notice.ts) and where it goes: the
// instructor's presenter only, never the room screen's frame (docs/design/music-files.md, "Where it
// sits"; ADR 0017 section 3). The words name the class document's song title and nothing from the disk.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLACEMENT } from "../../src/core/music-files/safe-text.ts";
import { musicNoticeOf } from "../../src/core/music-files/music-notice.ts";
import type { MusicNotice } from "../../src/core/music-files/music-notice.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import { createController } from "../../src/main/controller.ts";
import { loadExample } from "./fixtures.ts";

test("the four states of the spec, in its words", () => {
  const failed = { reason: "failed" } as const;
  assert.deepEqual(musicNoticeOf(failed, { song: 0, why: "read" }, "Neon Avenue"), { line: "Manual clock, music stopped", detail: "Neon Avenue could not be played", plate: { headline: "The music stopped", body: "Neon Avenue could not be read. The clock keeps running." } });
  assert.deepEqual(musicNoticeOf(failed, { song: 0, why: "length" }, "Neon Avenue"), { line: "Manual clock, music stopped", detail: "Neon Avenue is the wrong length", plate: { headline: "The music stopped", body: "Neon Avenue is the wrong length. The clock keeps running." } });
  assert.deepEqual(musicNoticeOf({ reason: "missing", missing: [1, 4] }, null, null), { line: "Manual clock", detail: "2 music files were missing when the class started", plate: null });
  assert.deepEqual(musicNoticeOf({ reason: "missing", missing: [1] }, null, null), { line: "Manual clock", detail: "1 music file was missing when the class started", plate: null });
  assert.equal(musicNoticeOf(null, null, null), null);
});

test("a failure with no song to blame, or a sign-out, keeps the clock line and names nobody", () => {
  const n = musicNoticeOf({ reason: "failed" }, { song: null, why: "signed_out" }, "Neon Avenue")!;
  assert.deepEqual([n.line, n.detail, n.plate?.body], ["Manual clock, music stopped", null, "The clock keeps running."]);
  assert.equal(musicNoticeOf({ reason: "failed" }, null, null)!.detail, null);
});

test("the song's title is neutralised, and nothing else of the document reaches the words", () => {
  const title = `Neon${String.fromCodePoint(0x202e)}Avenue${String.fromCodePoint(0)}`;
  const n = musicNoticeOf({ reason: "failed" }, { song: 0, why: "read" }, title)!;
  assert.equal(n.detail, `Neon${REPLACEMENT}Avenue${REPLACEMENT} could not be played`);
  assert.doesNotMatch(JSON.stringify(n), /[\\/]|sha|\.mp3/);
});

const CLASS = JSON.stringify(loadExample("valid/class-local-files.json"));

test("the presenter's snapshot carries the notice when the shell has one, and the room's frame never does", () => {
  const notice: MusicNotice = { line: "Manual clock, music stopped", detail: "Neon Avenue could not be played", plate: { headline: "The music stopped", body: "Neon Avenue could not be read. The clock keeps running." } };
  let current: MusicNotice | null = null;
  const c = createController(() => 0, undefined, null, () => current);
  assert.equal(c.snapshot().music ?? null, null, "no class open: nothing");
  assert.equal(c.open("class.json", CLASS).error, null);
  assert.equal(c.snapshot().music ?? null, null, "nothing to say");
  current = notice;
  const s = c.snapshot();
  assert.deepEqual(s.music, notice);
  const frame = JSON.stringify(roomFrameOf(s));
  for (const word of ["Neon Avenue", "music stopped", "The music stopped", "clock keeps running"]) assert.ok(!frame.includes(word), word);
  assert.ok(!("music" in roomFrameOf(s)), "the room frame has no such field");
});

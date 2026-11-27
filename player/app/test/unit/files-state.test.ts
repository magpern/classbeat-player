// The music files state of the local classes on the class list (main/music-files/files-state.ts):
// a check for every local row, the phases of a find (choosing the folder, then finding), what a find
// leaves (still missing, failed, cancelled), and Start held while anything runs. A fake music files
// service and a fake clock; no files, no dialog, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FindAnswer } from "../../src/core/music-files/answer.ts";
import { createFilesState, RETRY_MS } from "../../src/main/music-files/files-state.ts";
import type { ClassRow } from "../../src/core/sync/class-list.ts";
import { row } from "./list-fixtures.ts";

const song = (k: number) => ({ title: `Song ${k}`, artist: `Artist ${k}`, ids: { local_file: { sha256: String(k).repeat(64), size_bytes: 1000, file_name: `f${k}.mp3` } } });
const DOC = { music: { source: "local" }, songs: [song(1), song(2), song(3)] };
const done = (...s: Array<"found" | "missing">): FindAnswer => ({ status: "done", songs: s, limit_reached: false });
const ROWS: ClassRow[] = [row("Local one", 1, { source: "local", songs: 3 }), row("Local two", 2, { source: "local", songs: 3 }), row("Spotify", 3)];

function rig() {
  let now = 0;
  const r = {
    checks: [] as string[],
    finds: [] as string[],
    /** Answers the next check or find with this; null makes the service say it is busy. */
    checkAnswer: done("found", "missing", "missing") as FindAnswer | null,
    findAnswer: done("found", "found", "missing") as FindAnswer | null,
    gate: null as null | Promise<void>,
    release: (): void => undefined,
    cancelled: 0,
    tick: (ms: number) => (now += ms),
  };
  const state = createFilesState({
    music: {
      check: async (id) => {
        r.checks.push(id);
        await r.gate;
        return r.checkAnswer;
      },
      find: async (id) => {
        r.finds.push(id);
        await r.gate;
        return r.findAnswer;
      },
      cancel: () => (r.cancelled++, true),
    },
    document: () => DOC,
    now: () => now,
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return { r, state, settle };
}

test("only local rows have a view; each is checked once, one at a time, and says checking until it is answered", async () => {
  const { r, state, settle } = rig();
  const first = state.view(ROWS);
  assert.deepEqual(first.map((v) => [v.id, v.phase]), [[ROWS[0]!.id, "checking"], [ROWS[1]!.id, "checking"]]);
  assert.deepEqual(r.checks, [ROWS[0]!.id], "one check at a time");
  await settle();
  const second = state.view(ROWS);
  assert.deepEqual(second.map((v) => v.phase), ["idle", "checking"]);
  assert.deepEqual(r.checks, [ROWS[0]!.id, ROWS[1]!.id]);
  assert.equal(second[0]!.missing.length, 2);
  await settle();
  for (let i = 0; i < 5; i++) state.view(ROWS);
  assert.equal(r.checks.length, 2, "an answered class is not checked again");
});

test("a check that found the service busy is asked again after a while, not at once", async () => {
  const { r, state, settle } = rig();
  r.checkAnswer = null;
  state.view([ROWS[0]!]);
  await settle();
  state.view([ROWS[0]!]);
  assert.equal(r.checks.length, 1);
  r.tick(RETRY_MS);
  r.checkAnswer = done("found", "found", "found");
  state.view([ROWS[0]!]);
  await settle();
  assert.equal(r.checks.length, 2);
  assert.equal(state.view([ROWS[0]!])[0]!.missing.length, 0);
});

test("a new version of the class is a new state, checked again", async () => {
  const { r, state, settle } = rig();
  state.view([ROWS[0]!]);
  await settle();
  state.view([{ ...ROWS[0]!, hash: "sha256:other" }]);
  assert.equal(r.checks.length, 2);
});

test("a find goes through choosing, then finding, and leaves 'still missing' when files stay missing", async () => {
  const { r, state, settle } = rig();
  state.view([ROWS[0]!]);
  await settle();
  r.gate = new Promise<void>((ok) => void (r.release = ok));
  const found = state.find(ROWS[0]!.id);
  assert.equal(state.view([ROWS[0]!])[0]!.phase, "choosing");
  assert.equal(state.held(ROWS[0]!.id, ROWS[0]!.hash), true, "Start waits");
  state.picked();
  assert.equal(state.view([ROWS[0]!])[0]!.phase, "finding");
  r.release();
  assert.deepEqual(await found, r.findAnswer);
  const v = state.view([ROWS[0]!])[0]!;
  assert.deepEqual([v.phase, v.searched, v.failed, v.missing.length], ["idle", true, false, 1]);
  assert.equal(state.held(ROWS[0]!.id, ROWS[0]!.hash), false);
});

test("a find that found every file is not 'still missing'", async () => {
  const { r, state, settle } = rig();
  state.view([ROWS[0]!]);
  await settle();
  r.findAnswer = done("found", "found", "found");
  await state.find(ROWS[0]!.id);
  const v = state.view([ROWS[0]!])[0]!;
  assert.deepEqual([v.searched, v.missing.length], [false, 0]);
});

test("a find that failed says so, changes nothing else, and is cleared by the next find", async () => {
  const { r, state, settle } = rig();
  state.view([ROWS[0]!]);
  await settle();
  r.findAnswer = { status: "failed" };
  await state.find(ROWS[0]!.id);
  let v = state.view([ROWS[0]!])[0]!;
  assert.deepEqual([v.failed, v.phase, v.missing.length, v.searched], [true, "idle", 2, false]);
  r.findAnswer = done("found", "found", "found");
  const again = state.find(ROWS[0]!.id);
  assert.equal(state.view([ROWS[0]!])[0]!.failed, false, "the old failure is hidden while it runs");
  await again;
  v = state.view([ROWS[0]!])[0]!;
  assert.deepEqual([v.failed, v.missing.length], [false, 0]);
});

test("a find that throws is a failed find, with nothing of the error", async () => {
  const { state, settle } = rig();
  state.view([ROWS[0]!]);
  await settle();
  const s2 = createFilesState({ music: { check: async () => done("found", "found", "found"), find: () => Promise.reject(new Error("C:\\Music\\secret.mp3")), cancel: () => false }, document: () => DOC, now: () => 0 });
  s2.view([ROWS[0]!]);
  await settle();
  assert.deepEqual(await s2.find(ROWS[0]!.id), { status: "failed" });
  const v = s2.view([ROWS[0]!])[0]!;
  assert.equal(v.failed, true);
  assert.doesNotMatch(JSON.stringify(v), /secret|Music/);
});

test("a folder window closed without a choice goes back to the state before, with no message", async () => {
  const { r, state, settle } = rig();
  state.view([ROWS[0]!]);
  await settle();
  r.findAnswer = { status: "cancelled" };
  await state.find(ROWS[0]!.id);
  const v = state.view([ROWS[0]!])[0]!;
  assert.deepEqual([v.phase, v.failed, v.searched, v.missing.length], ["idle", false, false, 2]);
});

test("a second find while one runs does nothing; a find for a class the list never showed does nothing", async () => {
  const { r, state, settle } = rig();
  state.view(ROWS);
  await settle();
  state.view(ROWS);
  await settle();
  r.gate = new Promise<void>((ok) => void (r.release = ok));
  const first = state.find(ROWS[0]!.id);
  assert.equal(await state.find(ROWS[1]!.id), null);
  assert.equal(await state.find("nope"), null);
  assert.deepEqual(r.finds, [ROWS[0]!.id]);
  r.release();
  await first;
});

test("while any operation runs, Start of any local class waits (the check at Start would find the service busy)", async () => {
  const { r, state } = rig();
  r.gate = new Promise<void>((ok) => void (r.release = ok));
  state.view(ROWS);
  assert.equal(state.held(ROWS[1]!.id, ROWS[1]!.hash), true);
  r.release();
});

test("a find that changed the index asks every other class again; reset asks all again", async () => {
  const { r, state, settle } = rig();
  state.view(ROWS);
  await settle();
  state.view(ROWS);
  await settle();
  assert.equal(r.checks.length, 2);
  await state.find(ROWS[0]!.id);
  state.view(ROWS);
  await settle();
  assert.equal(r.checks.length, 3, "the other class is checked again, the one found is not");
  await settle();
  state.reset();
  state.view(ROWS);
  await settle();
  state.view(ROWS);
  assert.equal(r.checks.length, 5);
});

test("cancel goes to the service", () => {
  const { r, state } = rig();
  assert.equal(state.cancel(), true);
  assert.equal(r.cancelled, 1);
});

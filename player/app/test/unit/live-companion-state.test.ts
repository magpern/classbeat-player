// companion_state from the snapshot (issue #172, ADR 0005 section 4): what the teleprompter shows,
// matching the contract, with `allowed` from the presenter's routing. Pure; fakes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL } from "../../src/core/player-state.ts";
import { announcementOf, companionStateOf, MAX_NEXT_INTERVALS } from "../../src/core/live/companion-state.ts";
import { HANDOVER_TEXT } from "../../src/core/link/while-following.ts";
import { following, loaded, NOW, RUN, text, undoable, validCompanionState } from "./live-rig.ts";

const doc = JSON.parse(text) as {
  intervals: { start_ms: number; length_ms: number; zone: number; cue: string }[];
  songs: { start_ms: number; title: string; artist: string }[];
  zone_scale: { zone: number; name: string }[];
};

const allowedOf = (st: { readonly allowed: readonly string[] } | null): readonly string[] => st?.allowed ?? [];
const valid = (v: unknown): void => assert.ok(validCompanionState(v), JSON.stringify(validCompanionState.errors));

test("nothing to show while no class is open", () => {
  assert.equal(companionStateOf(INITIAL, NOW, true, RUN, 0), null);
});

test("the teleprompter's content: run, seq, status, times, the interval now and the next three, the next song", () => {
  const s = loaded({ mode: "manual", state: "Manual" }, "running", 60_000);
  const st = companionStateOf(s, NOW, true, RUN, 7);
  assert.ok(st);
  valid(st);
  assert.equal(st.run, RUN);
  assert.equal(st.seq, 7);
  assert.equal(st.status, "running");
  assert.equal(st.classMs, 60_000);
  const i = doc.intervals.findLastIndex((iv) => iv.start_ms <= 60_000);
  const iv = doc.intervals[i];
  assert.equal(st.now.index, i);
  assert.equal(st.now.cue, iv.cue);
  assert.deepEqual(st.now.zone, { number: iv.zone, name: doc.zone_scale.find((z) => z.zone === iv.zone)?.name });
  assert.equal(st.now.remainingMs, iv.start_ms + iv.length_ms - 60_000);
  assert.equal(st.next.length, MAX_NEXT_INTERVALS);
  assert.deepEqual(
    st.next.map((n) => n.startMs),
    doc.intervals.slice(i + 1, i + 4).map((n) => n.start_ms),
  );
  const song = doc.songs.find((x) => x.start_ms > 60_000);
  assert.deepEqual(st.nextSong, song ? { atMs: song.start_ms, title: song.title, artist: song.artist } : null);
  assert.deepEqual(st.link, { mode: "manual", state: "manual", canUndo: false, announcement: null });
});

test("status: not started, paused, ended, and holding at a window's end", () => {
  assert.equal(companionStateOf(loaded({}, "ready"), NOW, true, RUN, 0)?.status, "not_started");
  assert.equal(companionStateOf(loaded({}, "paused"), NOW, true, RUN, 0)?.status, "paused");
  assert.equal(companionStateOf(loaded({}, "ended"), NOW, true, RUN, 0)?.status, "ended");
  const held = companionStateOf(loaded(following("Locked", { held: true, holdUntil: NOW + 4000 }), "paused"), NOW, true, RUN, 0);
  assert.equal(held?.status, "holding");
  assert.equal(held?.now.remainingMs, 4000, "the elastic countdown of the hold");
});

test("the link: its mode and state, the undo and the announcement as a kind with seconds, never its text", () => {
  const st = companionStateOf(loaded(undoable()), NOW, true, RUN, 0);
  valid(st);
  assert.deepEqual(st?.link, { mode: "following", state: "locked", canUndo: true, announcement: { kind: "resynced_back", seconds: 30 } });
  assert.ok(allowedOf(st).includes("undo_resync"));
  assert.deepEqual(announcementOf({ text: "resynced, 12 s forward", deltaMs: 12_400, until: NOW }, NOW), { kind: "resynced_forward", seconds: 12 });
  assert.deepEqual(announcementOf({ text: HANDOVER_TEXT, deltaMs: 0, until: NOW }, NOW), { kind: "following_stopped", seconds: null });
  assert.equal(announcementOf({ text: HANDOVER_TEXT, deltaMs: 0, until: NOW }, NOW + 1), null, "gone when its time is up");
  const after = companionStateOf(loaded(undoable()), NOW + 30_001, true, RUN, 0);
  assert.deepEqual(after?.link.announcement, null);
  assert.equal(after?.link.canUndo, false);
  assert.ok(!allowedOf(after).includes("undo_resync"));
});

test("allowed follows the routing: while following with a transport the music is asked; without one, nothing that would go manual", () => {
  assert.deepEqual(companionStateOf(loaded(following("Locked"), "running"), NOW, true, RUN, 0)?.allowed, ["pause", "skip"]);
  assert.deepEqual(companionStateOf(loaded(following("Paused"), "paused"), NOW, true, RUN, 0)?.allowed, ["resume", "skip"]);
  assert.deepEqual(companionStateOf(loaded(following("Locked"), "running"), NOW, false, RUN, 0)?.allowed, []);
  assert.deepEqual(companionStateOf(loaded({ mode: "manual", state: "Manual" }, "running"), NOW, true, RUN, 0)?.allowed, ["pause", "skip", "nudge"]);
  assert.deepEqual(companionStateOf(loaded({ mode: "manual", state: "Manual" }, "ready"), NOW, false, RUN, 0)?.allowed, ["start", "skip", "nudge"]);
  assert.deepEqual(companionStateOf(loaded({ mode: "manual", state: "Manual" }, "ended"), NOW, false, RUN, 0)?.allowed, ["nudge"]);
});

test("it holds only the teleprompter's fields: no rider, token, code, account or device field", () => {
  const st = companionStateOf(loaded(undoable()), NOW, true, RUN, 0);
  assert.deepEqual(Object.keys(st ?? {}).sort(), ["allowed", "classMs", "classRemainingMs", "lengthMs", "link", "next", "nextSong", "now", "run", "seq", "status", "type", "v"]);
});

test("long texts are clipped to the contract's lengths", () => {
  const s = loaded({ mode: "manual", state: "Manual" }, "running", 0);
  const l = s.loaded!;
  const long = "x".repeat(300);
  const d = { ...l.doc, intervals: l.doc.intervals.map((iv) => ({ ...iv, cue: long })), songs: l.doc.songs.map((x) => ({ ...x, title: long, artist: long })), zone_scale: l.doc.zone_scale.map((z) => ({ ...z, name: long })) } as typeof l.doc;
  const st = companionStateOf({ ...s, loaded: { ...l, doc: d } }, NOW, true, RUN, 0);
  valid(st);
  assert.equal(st?.now.cue.length, 120);
  assert.equal(st?.now.zone.name.length, 80);
  assert.equal(st?.nextSong?.title.length, 200);
});

test("holding and paused: a hold at a window's end says holding; a paused music or clock says paused; the class end says ended", () => {
  const at = (link: Parameters<typeof loaded>[0], status: Parameters<typeof loaded>[1]) => companionStateOf(loaded(link, status), NOW, true, RUN, 0)?.status;
  assert.equal(at(following("Locked", { held: true, holdUntil: NOW + 4000 }), "paused"), "holding", "the clock stands still at the window's end");
  assert.equal(at(following("Paused", { held: false }), "paused"), "paused", "the music is paused");
  assert.equal(at({ mode: "manual", state: "Manual", held: false }, "paused"), "paused");
  assert.equal(at(following("Locked", { held: true, holdUntil: NOW + 4000 }), "ended"), "ended", "the end wins over a hold");
});

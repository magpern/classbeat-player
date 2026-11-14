// A torn reading at a song change is held for one poll (spike 1, #459).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createClock, positionAt, tick } from "../../src/core/clock/index.ts";
import type { ClockState } from "../../src/core/clock/index.ts";
import { DEFAULT_LINK_CONFIG, initialLink, step } from "../../src/core/link/index.ts";
import type { LinkEvent, LinkModel, LinkPlan, Observation } from "../../src/core/link/index.ts";
import { isTornReading } from "../../src/core/link/torn.ts";

const RHYTHM = { title: "Rhythm Is a Dancer", artist: "Snap!", trackId: "spotify:track:rhythm" };
const FIRE = { title: "Firestarter", artist: "The Prodigy", trackId: "spotify:track:fire" };
const plan: LinkPlan = {
  plannedCrossfadeMs: 0,
  manualOnly: false,
  songs: [
    { index: 0, title: RHYTHM.title, artist: RHYTHM.artist, lengthMs: 322_230, startMs: 0, endMs: 322_230, trackIds: ["rhythm"] },
    { index: 1, title: FIRE.title, artist: FIRE.artist, lengthMs: 269_800, startMs: 322_230, endMs: 592_030, trackIds: ["fire"] },
  ],
};
// Reading times in ms; the first reading sits at the end of the first song.
const T0 = 57_190;
const obs = (t: number, who: typeof RHYTHM, positionMs: number, lengthMs: number, playing = true): Observation => ({ ...who, lengthMs, positionMs, playing, at: t, seenAt: t });
const R1 = obs(T0, RHYTHM, 322_083, 322_230);
const TORN = obs(T0 + 250, RHYTHM, 10, 269_800);
const R3 = obs(T0 + 500, FIRE, 260, 269_800);

interface Rig {
  link: LinkModel;
  clock: ClockState;
  events: LinkEvent[];
  clockMs: number[];
}
function replay(readings: readonly Observation[]): Rig {
  const rig: Rig = { link: initialLink(true), clock: createClock(592_030, 0), events: [], clockMs: [] };
  for (const o of readings) {
    const r = step(rig.link, rig.clock, plan, o, o.seenAt, DEFAULT_LINK_CONFIG);
    rig.link = r.link;
    rig.clock = tick(r.clock, o.seenAt);
    if (r.event) rig.events.push(r.event);
    rig.clockMs.push(positionAt(rig.clock, o.seenAt));
  }
  return rig;
}

test("replay: the torn reading is held, then the song changes with a continuous clock", () => {
  const rig = replay([R1, TORN, R3]);
  assert.deepEqual(rig.events, ["locked", "torn_hold", "song_change"]);
  for (let i = 1; i < rig.clockMs.length; i++) assert.ok(rig.clockMs[i] >= rig.clockMs[i - 1], `clock moved back at ${i}`);
  // Song 1 starts at 322 230 ms; 260 ms in is 322 490, within 500 ms of where the clock was.
  assert.ok(Math.abs(rig.clockMs[2] - 322_490) <= 500, String(rig.clockMs[2]));
  assert.equal(rig.link.songIndex, 1);
});

test("a held reading is never stored as the last applied one", () => {
  const rig = replay([R1, TORN]);
  assert.equal(rig.link.applied, R1);
  assert.equal(rig.link.tornHeld, true);
});

test("a torn reading confirmed by the next reading applies one poll late", () => {
  const confirmed = obs(T0 + 500, RHYTHM, 260, 269_800);
  const rig = replay([R1, TORN, confirmed]);
  assert.deepEqual(rig.events.slice(0, 2), ["locked", "torn_hold"]);
  assert.equal(rig.link.applied, confirmed);
  assert.equal(rig.link.tornHeld, false);
});

test("a second inconsistent reading in a row is applied (no endless hold)", () => {
  const second = obs(T0 + 500, RHYTHM, 10, 269_800);
  const rig = replay([R1, TORN, second]);
  assert.equal(rig.events.filter((e) => e === "torn_hold").length, 1);
  assert.equal(rig.link.applied, second);
  assert.equal(rig.link.tornHeld, false);
});

test("a real seek to 0:00 with an unchanged length applies at once", () => {
  const seek = obs(T0 + 250, RHYTHM, 0, 322_230);
  const rig = replay([R1, seek]);
  assert.equal(rig.events.includes("torn_hold"), false);
  assert.equal(rig.link.applied, seek);
});

test("isTornReading: only the same track, near the start, jumping back, with a changed length", () => {
  const cfg = DEFAULT_LINK_CONFIG;
  assert.equal(isTornReading(null, TORN, T0 + 250, cfg), false);
  assert.equal(isTornReading(R1, TORN, T0 + 250, cfg), true);
  assert.equal(isTornReading(R1, R3, T0 + 500, cfg), false); // another track
  assert.equal(isTornReading(R1, { ...TORN, positionMs: 5000 }, T0 + 250, cfg), false); // not near the start
  assert.equal(isTornReading(R1, { ...TORN, lengthMs: null }, T0 + 250, cfg), false);
  assert.equal(isTornReading(R1, { ...TORN, lengthMs: 322_230 - cfg.lengthToleranceMs }, T0 + 250, cfg), false);
  assert.equal(isTornReading(obs(T0, RHYTHM, 100, 322_230), { ...TORN, positionMs: 0 }, T0 + 250, cfg), false); // not a jump back
});

// The shared-1 gates on the real page (scene.md "The CI check that the sway makes at most 1", "The CI gate for a burst's decay"): each case
// is played at 60 fps in headless Chrome, locked with the beat, locked at Tempo only and coasting, the canvas alone is read every frame
// (linear light, the gate's regions of tools/flash-shots.ts), and tools/shared-one.ts counts with the strict measure. A case that counts more
// than 1 fails the run; a matrix with a look, a zone, a parity, a tempo, a quality level or a state that has no case fails it too, and so
// does a burst the S6 report asserts that the scheduler did not place. A case that fails is fixed in the light or the schedule, never in the measure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { genName, tempoName } from "../demo/generated.ts";
import { violations } from "./guard-trap.ts";
import { REGIONS, probeSetup } from "./flash-shots.ts";
import { frameTimes } from "./luminance-steps.ts";
import { SHARED_MAX, burstFrames, decayCount, mostAround, wholeRun, worstRegion } from "./shared-one.ts";
import type { Worst } from "./shared-one.ts";
import { CUT_CAUSES, GAPS_MS, cutCase, placedBy } from "./shared-cuts.ts";
import { CAUSE_STATES, overlapCase, overlapOffsets, sweepCases } from "./shared-sweeps.ts";
import { STATES, lookByZone, missing, phraseStartMs, specOf } from "./shared-cases.ts";
import type { Factors, StateName } from "./shared-cases.ts";
import type { Open } from "./text-shots.ts";
import type { Page } from "playwright-core";

interface Series { t: number[]; regions: number[][]; burst: number[] }
export interface Played { readonly wall: number[]; readonly regions: number[][]; readonly burst: number[] }
export interface Result {
  readonly gate: string; readonly name: string; readonly state: StateName; readonly most: number; readonly region: string;
  /** The worst region's changes, in ms from the burst's rise (a burst) or from the run's first frame: where the count comes from. */
  readonly changes?: readonly { readonly atMs: number; readonly rising: boolean; readonly from: number; readonly to: number }[];
  /** For a burst: whether it rose, and what S6 asserts of it (null: not asserted in this state). */
  readonly burst?: { readonly placed: boolean; readonly asserted: boolean };
}

interface Play {
  readonly className: string;
  readonly query: string;
  readonly quality?: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly events?: readonly { readonly atMs: number; readonly link?: string; readonly jumpMs?: number }[];
}

/** Plays one run of the page, the canvas alone (no text layer), and returns the whole frame's regions per frame. */
async function play(open: Open, p: Play): Promise<Played> {
  const { page, problems } = await open(480, 270, `${p.query}&text=0&q=${p.quality ?? "High"}&class=${encodeURIComponent(p.className)}`);
  await page.evaluate(probeSetup);
  await page.evaluate("window.__steps.check = () => {}"); // S5 is gated on the real frames (tools/flash-shots.ts)
  await page.evaluate(`window.__steps.begin(${p.fromMs / 1000}, ${p.toMs / 1000}, ${JSON.stringify(p.events ?? [])})`);
  await page.evaluate(() => (window as unknown as { __scene: { resume(): unknown } }).__scene.resume());
  const out = await page.evaluate(() => (window as unknown as { __steps: Series }).__steps);
  assert.deepEqual([...problems, ...(await violations(page as Page))], [], p.className);
  await page.close();
  return { wall: frameTimes(out.t), regions: out.regions, burst: out.burst };
}

const names = REGIONS.map(([name]) => name);
/** Keeps a result, and says so at once when a case is over the limit, so a long run shows its failures as they come. */
function record(results: Result[], r: Result): void {
  results.push(r);
  if (r.most > SHARED_MAX) console.log(`OVER ${r.gate} ${r.name}, ${r.state}: ${r.most} in ${r.region}`);
}
/** `SHARED_CASE="fan zone 7" npm run shared -- sway` plays the cases whose name holds the text. */
const FRAME_MS = 1000 / 60;
const wanted = (name: string): boolean => name.includes(process.env.SHARED_CASE ?? "");
/** The worst region's changes in ms from the run's first frame, for the artifact: where a count comes from. */
const relative = (w: Worst, first: number): Result["changes"] => w.changes.map((c) => ({ atMs: Math.round(c.atMs - first), rising: c.rising, from: Number(c.from.toFixed(3)), to: Number(c.to.toFixed(3)) }));

/** The looks' sway: every look in every zone row, both parities, the tempos and quality levels, a stretch of one phrase at rest, in each state. */
async function swayMatrix(open: Open, results: Result[]): Promise<void> {
  const cases = lookByZone();
  const holes = missing(cases);
  assert.deepEqual(holes, [], `the sway matrix has no case for: ${holes.join(", ")}`);
  for (const state of STATES) for (const f of cases) {
    const name = `${f.look} zone ${f.zone} parity ${f.parity} ${f.bpm} bpm ${f.quality}`;
    if (!wanted(name)) continue;
    const at = SONG_START_MS_OF(f) + phraseStartMs(f) + 4500; // 4.5 s after a phrase flip: every turn has arrived, no flip until the next phrase
    const played = await play(open, { className: genName(specOf(f, state.tempoOnly)), query: state.query, quality: f.quality, fromMs: at, toMs: at + 2400 });
    const w = worstRegion(names, played.wall, played.regions, wholeRun);
    record(results, { gate: "sway", name, state: state.name, most: w.most, region: w.region, changes: relative(w, played.wall[0]!) });
  }
}
const SONG_START_MS_OF = (f: Factors): number => specOf(f, false).startMs;

/** A burst of the demo class (and `COLLIDE_CLASS`): drawn as the scheduler places it, and counted around its decay with the rise left out. */
interface Named { readonly name: string; readonly cls: string; readonly fromS: number; readonly toS: number; readonly asserted: readonly StateName[] }
export const NAMED: readonly Named[] = [
  { name: "drop at 40 s", cls: "demo", fromS: 38.5, toS: 44, asserted: ["coasting"] },
  { name: "drop at 40.4 s (collide)", cls: "collide", fromS: 38.5, toS: 44, asserted: ["coasting"] },
  { name: "drop at 58 s", cls: "demo", fromS: 54, toS: 59, asserted: ["locked", "tempo only", "coasting"] },
  { name: "light-only burst at 80 s", cls: "demo", fromS: 78.5, toS: 83, asserted: ["coasting"] },
];

async function namedBursts(open: Open, results: Result[]): Promise<void> {
  for (const n of NAMED.filter((x) => wanted(x.name))) for (const state of STATES) {
    const played = await play(open, { className: state.tempoOnly ? tempoName(n.cls) : n.cls, query: state.query, fromMs: n.fromS * 1000, toMs: n.toS * 1000 });
    const frames = burstFrames(played.wall, played.burst);
    const asserted = n.asserted.includes(state.name);
    if (frames === null) { record(results, { gate: "decay", name: n.name, state: state.name, most: 0, region: "", burst: { placed: false, asserted } }); continue; }
    const w = worstRegion(names, played.wall, played.regions, decayCount(frames));
    const rel = w.changes.map((c) => ({ atMs: Math.round(c.atMs - frames.riseMs), rising: c.rising, from: Number(c.from.toFixed(3)), to: Number(c.to.toFixed(3)) })).filter((c) => c.atMs > -2500 && c.atMs < 2500);
    record(results, { gate: "decay", name: n.name, state: state.name, most: w.most, region: w.region, changes: rel, burst: { placed: true, asserted } });
  }
}

/** The cut cases (B7, B8): the decay beside a planned window, drawn with the whole turn; the count holds over the decay and over the turn the cut took out. */
async function cutCases(open: Open, results: Result[], pool: readonly Factors[]): Promise<void> {
  let n = 0;
  for (const kind of ["drop", "light"] as const) for (const cause of CUT_CAUSES) for (const gapMs of GAPS_MS) {
    if (kind === "light" && cause === "gather") continue; // a gather is a drop's
    const mine = cause === "song change" ? pool.filter((f) => f.look !== "fan") : pool;
    const f = mine[(n++ * 11 + 4) % mine.length]!;
    for (const state of STATES) {
      const c = cutCase(kind, cause, gapMs, f, state.tempoOnly);
      const name = `${kind} burst, decay ${gapMs} ms ${cause === "turn after" ? "before the turn" : `after the ${cause}'s window`} (${f.look}, zone ${f.zone}, ${f.bpm} bpm)`;
      if (!wanted(name)) continue;
      const predicted = placedBy(c, state);
      const asserted = kind === "drop" || state.name === "coasting"; // a light-only burst on a change is skipped beside a ramp, at the Beat level and at Tempo only
      const played = await play(open, { className: genName(c.spec), query: state.query, quality: f.quality, fromMs: c.fromMs, toMs: c.toMs });
      const frames = burstFrames(played.wall, played.burst);
      assert.equal(frames !== null, predicted, `${name}, ${state.name}: the page and the loop disagree on the burst`);
      if (frames === null) { record(results, { gate: "cut", name, state: state.name, most: 0, region: "", burst: { placed: false, asserted } }); continue; }
      const at = (ms: number) => played.wall[0]! + (ms - c.fromMs); // the frames' wall times start at the run's first frame
      const count = (changes: Parameters<typeof mostAround>[0]) => Math.max(mostAround(changes, frames.decay, frames.riseMs), mostAround(changes, { fromMs: at(c.away.fromMs), toMs: at(c.away.toMs) }, frames.riseMs));
      const w = worstRegion(names, played.wall, played.regions, count);
      record(results, { gate: "cut", name, state: state.name, most: w.most, region: w.region, changes: relative(w, frames.riseMs), burst: { placed: true, asserted } });
    }
  }
}

/** The sweeps: one case of every cause, in each state it exists in, and the overlaps of a phrase flip and a gather at every offset of 250 ms. */
async function sweepMatrix(open: Open, results: Result[]): Promise<void> {
  const cases = sweepCases();
  const holes = missing(cases.map((c) => ({ ...c.factors, state: c.state, cause: c.cause })), { causes: Object.keys(CAUSE_STATES), states: STATES.map((s) => s.name) });
  assert.deepEqual(holes, [], `the sweep matrix has no case for: ${holes.join(", ")}`);
  const pick = lookByZone().find((f) => f.look === "circle" && f.zone === 4)!;
  const overlaps = overlapOffsets().flatMap((o) => [overlapCase(o, false, pick), overlapCase(o, true, pick)]);
  for (const c of [...cases, ...overlaps].filter((x) => wanted(x.name))) {
    const state = STATES.find((s) => s.name === c.state)!;
    const played = await play(open, { className: genName(c.spec), query: c.startsCoasting === true ? "&state=coasting" : state.query, quality: c.factors.quality, fromMs: c.fromMs, toMs: c.toMs, events: c.events });
    // The count starts where the case says: a pause and a resume are user actions, scheduled changes, and are over by then.
    const skip = c.countFromMs === undefined ? 0 : Math.round((c.countFromMs - c.fromMs) / FRAME_MS);
    const w = worstRegion(names, played.wall.slice(skip), played.regions.slice(skip), wholeRun);
    record(results, { gate: "sweep", name: c.name, state: c.state, most: w.most, region: w.region, changes: relative(w, played.wall[skip]!) });
  }
}

/** Plays the gates, writes artifacts/shared-one.json, and fails on a case over 1, an asserted burst not placed, or a matrix with a hole. */
export async function reportShared(open: Open, artifacts: string, only: readonly string[] = ["sway", "decay", "cut", "sweep"]): Promise<Result[]> {
  const results: Result[] = [];
  if (only.includes("sway")) await swayMatrix(open, results);
  if (only.includes("decay")) await namedBursts(open, results);
  if (only.includes("cut")) await cutCases(open, results, lookByZone());
  if (only.includes("sweep")) await sweepMatrix(open, results);
  for (const gate of only) {
    const mine = results.filter((r) => r.gate === gate);
    console.log(`Shared 1, ${gate}: ${mine.length} cases, worst ${Math.max(...mine.map((r) => r.most))} (limit ${SHARED_MAX}); ${mine.filter((r) => r.burst?.placed === false).length} skipped`);
  }
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "shared-one.json"), JSON.stringify({ limit: SHARED_MAX, results }, null, 2));
  assert.ok(results.length > 0, "the shared 1: nothing was measured");
  assert.deepEqual(results.filter((r) => r.burst?.asserted === true && !r.burst.placed).map((r) => `${r.name}, ${r.state}`), [], "a burst S6 asserts was not placed");
  assert.deepEqual(results.filter((r) => r.most > SHARED_MAX).map((r) => `${r.gate} ${r.name}, ${r.state}: ${r.most} in ${r.region}`), [], "the shared 1: a case counts more than 1");
  return results;
}

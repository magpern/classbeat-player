// `--scene-steady-max` in the S6 gate (scene.md "The flash budget"): every moment of the demo class (the same list and the same
// regions as the strict count in flash-shots.ts) is played at 60 fps in headless Chrome, locked with the beat and coasting, with
// steady light alone drawn (`steady=1`: the beat lift, lens flash, burst, energy ramp, dims, haze steps and wall chase taken out;
// src/steady-calc.ts), and tools/steady-rate.ts reads, in every region, the most its luminance moves in any 1 s. The run fails if
// any region of any run moves more than 3 % of its luminance in a second. The canvas alone is read: the text layer is still
// between its steps, so leaving it out is the stricter measure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VARIANTS } from "../demo/scenario.ts";
import { MOMENTS, REGIONS, STATES as BEAT_STATES, probeSetup } from "./flash-shots.ts";
import { STEADY_MAX, worstRate } from "./steady-rate.ts";
import { frameTimes } from "./luminance-steps.ts";
import { violations } from "./guard-trap.ts";
import type { Open } from "./text-shots.ts";

interface Series { t: number[]; regions: number[][]; sweeping: boolean[]; marks: string[] }
export interface SteadyRun { readonly moment: string; readonly state: string; readonly worst: number; readonly region: string; readonly atMs: number; readonly steps: number; readonly windows: number; readonly unnamedAtMs: readonly number[]; readonly taken: readonly { readonly atMs: number; readonly cause: string; readonly share: number }[] }

/** The states: locked with the beat (Beat level), coasting (None level) and locked at the Tempo only level (no anchors). */
export const STATES = [...BEAT_STATES, ["tempo only", "&level=tempo"]] as const;

/** Plays one moment with steady light alone and returns the worst region's rate. */
async function play(open: Open, name: string, state: string, query: string, fromS: number, toS: number, events: unknown, cls: string | undefined): Promise<SteadyRun> {
  const { page, problems } = await open(480, 270, `${query}&steady=1&text=0${cls === undefined ? "" : `&class=${cls}`}`);
  await page.evaluate(probeSetup);
  await page.evaluate("window.__steps.check = () => {}"); // S5 is gated on the real frames; here the frames are not the product's
  await page.evaluate(`window.__steps.begin(${fromS}, ${toS}, ${JSON.stringify(events ?? [])})`);
  for (let done = false; !done; ) {
    const r = await page.evaluate(() => (window as unknown as { __scene: { resume(): { pending: number | null; done: boolean } } }).__scene.resume());
    if (r.pending !== null) await page.evaluate(`window.__steps.measure(${r.pending})`);
    done = r.done;
  }
  const out = await page.evaluate(() => (window as unknown as { __steps: Series }).__steps);
  assert.deepEqual([...problems, ...(await violations(page))], [], name);
  await page.close();
  // The window is 1 s, or one beat when the slowest song of the class is slower than 60 bpm (`--scene-steady-max`).
  const slowest = Math.min(...(VARIANTS[cls ?? "demo"] ?? VARIANTS.demo!).cls.songs.map((song) => song.bpm ?? 120));
  const windowMs = Math.max(1000, 60_000 / slowest);
  const wall = frameTimes(out.t);
  let best: SteadyRun = { moment: name, state, worst: 0, region: "", atMs: 0, steps: 0, windows: Number.POSITIVE_INFINITY, unnamedAtMs: [], taken: [] };
  REGIONS.forEach(([region], r) => {
    const rate = worstRate(wall, out.regions.map((row) => row[r]!), out.sweeping, out.marks, windowMs);
    const windows = Math.min(best.windows, rate.windows);
    const unnamedAtMs = [...new Set([...best.unnamedAtMs, ...rate.unnamedAtMs])];
    // The jumps taken out, once each (the same frame's jump shows in many regions): the largest share of the regions.
    const taken = [...best.taken.filter((t) => !rate.taken.some((u) => u.atMs === t.atMs)), ...rate.taken.map((u) => ({ ...u, share: Math.max(u.share, best.taken.find((t) => t.atMs === u.atMs)?.share ?? 0) }))].sort((x, y) => x.atMs - y.atMs);
    best = rate.worst > best.worst || best.region === "" ? { moment: name, state, worst: rate.worst, region, atMs: Math.round(rate.atMs), steps: rate.steps, windows, unnamedAtMs, taken } : { ...best, windows, unnamedAtMs, taken };
  });
  return best;
}

/** Plays every moment in each state and gates steady light at `--scene-steady-max` in every region. */
export async function reportSteady(open: Open, artifacts: string, only?: readonly string[]): Promise<SteadyRun[]> {
  const runs: SteadyRun[] = [];
  for (const m of MOMENTS) {
    if (only !== undefined && !only.some((o) => m.name.startsWith(o))) continue;
    const line: string[] = [];
    for (const [state, query] of STATES) {
      const run = await play(open, m.name, state, query, m.fromS, m.toS, m.events, m.cls);
      runs.push(run);
      line.push(`${state} ${(run.worst * 100).toFixed(2)} % (${run.region}, from ${run.atMs} ms, ${run.steps} jumps taken out)`);
      for (const t of run.taken) line.push(`[${state}: took out a ${(t.share * 100).toFixed(1)} % jump at ${t.atMs} ms, cause: ${t.cause}]`);
    }
    console.log(`Steady light, ${m.name}: ${line.join(", ")} (limit ${STEADY_MAX * 100} %)`);
  }
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "steady-light.json"), JSON.stringify({ limitPerSecond: STEADY_MAX, runs }, null, 2));
  assert.ok(runs.length > 0, "steady light: nothing was measured");
  assert.deepEqual(runs.filter((r) => r.windows < 1).map((r) => `${r.moment}, ${r.state}`), [], "steady light: a moment in which no 1 s window was read");
  assert.deepEqual(runs.filter((r) => r.unnamedAtMs.length > 0).map((r) => `${r.moment}, ${r.state}: a jump of more than 2 % on an unmarked frame at ${r.unnamedAtMs.slice(0, 3).join(", ")} ms`), [], "steady light: a one-frame jump no mark names");
  assert.deepEqual(runs.filter((r) => r.worst > STEADY_MAX).map((r) => `${r.moment}, ${r.state}: ${(r.worst * 100).toFixed(2)} % in ${r.region} from ${r.atMs} ms`), [], "steady light moved a region more than 3 % in a second");
  return runs;
}

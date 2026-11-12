import { readFileSync } from "node:fs";
import { buildPlan, type Plan } from "../src/core/class_plan.js";
import { ClassFollower } from "../src/core/follower.js";
import type { Decision } from "../src/core/types.js";
import { FakeReader, type FakeScript, type TrackRef } from "../src/readers/fake.js";

export const plan: Plan = buildPlan(JSON.parse(readFileSync(new URL("../example/class.spike.json", import.meta.url), "utf8")));

export function track(i: number): TrackRef {
  const s = plan.songs[i]!;
  return { trackId: s.trackId, title: s.title, artist: s.artist, durationMs: s.durationMs };
}

/** A song of this class started at real time `at`, optionally with an offset into the song. */
export const play = (i: number, at: number, positionMs = 0) => ({ at, track: track(i), positionMs, state: "playing" as const });

export interface Run {
  ds: Decision[];
  follower: ClassFollower;
}

/** Poll the fake at `rate` Hz from 0 to `endMs` and collect every decision. */
export function simulate(script: FakeScript, endMs: number, opts: { stepMs?: number; noiseMs?: number } = {}): Run {
  const step = opts.stepMs ?? 250;
  const reader = new FakeReader(script);
  const follower = new ClassFollower(plan);
  const ds: Decision[] = [];
  let seed = 7;
  for (let t = 0; t <= endMs; t += step) {
    const r = reader.readAt(t);
    if (r && opts.noiseMs) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      r.positionMs += Math.round(((seed / 2147483648) * 2 - 1) * opts.noiseMs);
    }
    ds.push(follower.step(t, r));
  }
  return { ds, follower };
}

export const at = (ds: Decision[], t: number): Decision => ds.find((d) => d.nowMs === t)!;

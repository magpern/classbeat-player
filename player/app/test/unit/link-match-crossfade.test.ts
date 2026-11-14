// The length rule when the music app reports a length minus the crossfade (spike 1, #459).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LINK_CONFIG, matchCandidates } from "../../src/core/link/index.ts";
import type { LinkPlan, Observation } from "../../src/core/link/index.ts";

const planWith = (crossfadeMs: number): LinkPlan => ({
  plannedCrossfadeMs: crossfadeMs,
  manualOnly: false,
  songs: [{ index: 0, title: "Mr. Vain", artist: "Culture Beat", lengthMs: 336_840, startMs: 0, endMs: 326_840, trackIds: ["abc123"] }],
});
const obs = (o: Partial<Observation>): Observation => ({ title: "Mr. Vain", artist: "Culture Beat", positionMs: 0, playing: true, at: 0, seenAt: 0, ...o });
const tol = DEFAULT_LINK_CONFIG.lengthToleranceMs;

const CASES: readonly { name: string; crossfade: number; lengthMs: number | null; expected: number[] }[] = [
  { name: "crossfade 0, real length", crossfade: 0, lengthMs: 336_840, expected: [0] },
  { name: "crossfade 0, within tolerance", crossfade: 0, lengthMs: 336_840 + tol, expected: [0] },
  { name: "crossfade 0, a 10 s shorter length is rejected (undeclared crossfade)", crossfade: 0, lengthMs: 326_840, expected: [] },
  { name: "crossfade 10 s, real length", crossfade: 10_000, lengthMs: 336_840, expected: [0] },
  { name: "crossfade 10 s, length minus crossfade", crossfade: 10_000, lengthMs: 326_840, expected: [0] },
  { name: "crossfade 10 s, minus crossfade within tolerance", crossfade: 10_000, lengthMs: 326_840 - tol, expected: [0] },
  { name: "crossfade 10 s, minus crossfade just outside tolerance", crossfade: 10_000, lengthMs: 326_840 - tol - 1, expected: [] },
  { name: "crossfade 10 s, between the two lengths", crossfade: 10_000, lengthMs: 331_840, expected: [] },
  { name: "crossfade 10 s, minus twice the crossfade", crossfade: 10_000, lengthMs: 316_840, expected: [] },
  { name: "crossfade 10 s, length not reported", crossfade: 10_000, lengthMs: null, expected: [0] },
];
for (const c of CASES) {
  test(`length rule: ${c.name}`, () => assert.deepEqual(matchCandidates(planWith(c.crossfade), obs({ lengthMs: c.lengthMs }), DEFAULT_LINK_CONFIG), c.expected));
}

test("length rule: the track id path ignores the length", () => {
  assert.deepEqual(matchCandidates(planWith(0), obs({ trackId: "spotify:track:abc123", lengthMs: 100_000 }), DEFAULT_LINK_CONFIG), [0]);
});

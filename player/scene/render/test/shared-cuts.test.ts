// The burst-decay gate's cut cases (tools/shared-cuts.ts, scene.md "The CI gate for a burst's decay"): each generated case really puts the decay
// 0.1, 0.5 or 0.9 s from the planned window it names, the scheduler places the burst and cuts that window to 1 s from the decay (only its length),
// a drop's burst is placed in every state, and no beam differs from the same sweep drawn without the burst (rule 4, S7).
import assert from "node:assert/strict";
import { test } from "node:test";
import { genName } from "../demo/generated.ts";
import { VARIANTS, feedAt } from "../demo/scenario.ts";
import { RunBudget } from "../src/budget-calc.ts";
import type { Where } from "../src/budget-calc.ts";
import { RigLoop } from "../src/loop.ts";
import { STATES, lookByZone } from "../tools/shared-cases.ts";
import { CUT_CAUSES, GAPS_MS, cutCase, placedBy } from "../tools/shared-cuts.ts";
import type { BurstKind, CutCase } from "../tools/shared-cuts.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const pool = lookByZone();
const cases: CutCase[] = [];
let n = 0;
for (const kind of ["drop", "light"] as const satisfies readonly BurstKind[]) for (const cause of CUT_CAUSES) for (const gapMs of GAPS_MS) {
  if (kind === "light" && cause === "gather") continue;
  const mine = cause === "song change" ? pool.filter((f) => f.look !== "fan") : pool;
  cases.push(cutCase(kind, cause, gapMs, mine[(n++ * 11 + 4) % mine.length]!, false));
}

function admitted(c: CutCase): { placed: boolean; budget: RunBudget } {
  const variant = VARIANTS[genName(c.spec)]!;
  const classMs = c.decay.fromMs - 500;
  const feed = feedAt(classMs, { variant });
  const where: Where = { cls: variant.cls, classMs, songIndex: feed.songIndex, songPosMs: feed.songPosMs, level: "Beat" };
  const budget = new RunBudget();
  const kind = c.kind === "drop" ? "dropBurst" : "lightBurst";
  return { placed: budget.admit("x", kind, [c.decay], where), budget };
}

test("the generated cases cover both burst kinds, the four causes and the three gaps, in 21 cases", () => {
  assert.equal(cases.length, 21, "2 kinds x 4 causes x 3 gaps, less the light-only gather");
  assert.deepEqual([...new Set(cases.map((c) => c.cause))].sort(), [...CUT_CAUSES].sort());
  assert.deepEqual([...new Set(cases.map((c) => c.kind))].sort(), ["drop", "light"]);
  assert.deepEqual([...new Set(cases.map((c) => c.gapMs))].sort(), [...GAPS_MS]);
});

test("every cut case is placed with its step moved into the rise frame, or skipped and recorded where the sway would resume or stop within 1 s of the decay", () => {
  const seen: Record<string, number> = {};
  for (const c of cases) {
    const { placed, budget } = admitted(c);
    const name = `${c.kind} ${c.cause} ${c.gapMs} ms`;
    const rise = c.decay.fromMs - 1000 / 60;
    assert.notEqual(c.step, "overlaps", `${name}: the decay is not in a span`);
    if (c.cause === "turn after") assert.equal(c.step, "b8", `${name}: a turn that follows is B8`);
    else assert.notEqual(c.step, "b8", `${name}: a step before the decay is B7`);
    if (c.swaySkip) {
      assert.equal(placed, false, `${name}: skipped`);
      assert.deepEqual([budget.nearSway(), budget.cuts()], [["x"], []], `${name}: the skip is recorded, no step moved`);
      seen.skipped = (seen.skipped ?? 0) + 1;
      continue;
    }
    assert.equal(placed, true, `${name}: placed`);
    assert.deepEqual(budget.nearSway(), [], name);
    const mine = budget.cuts().filter((cut) => Math.abs((cut.kind === "b7" ? cut.onMs : cut.offMs) - rise) < 1e-6);
    assert.equal(mine.length > 0, c.step !== "clear", `${name}: the scheduler's cut agrees with the plan (${c.step})`);
    seen[c.step] = (seen[c.step] ?? 0) + 1;
  }
  assert.ok((seen.skipped ?? 0) >= 10 && (seen.b7 ?? 0) >= 2, `skips and placed cuts both built: ${JSON.stringify(seen)}`);
});

test("a drop's burst is placed in every state, the light-only burst coasting, unless the sway skips it; where a ramp has the room a light-only burst on a change is skipped", () => {
  const skipped: string[] = [];
  for (const c of cases) for (const state of STATES) {
    const here = cutCase(c.kind, c.cause, c.gapMs, c.factors, state.tempoOnly);
    const placed = placedBy(here, state);
    if (here.swaySkip) assert.equal(placed, false, `${c.kind} ${c.cause} ${c.gapMs} ms, ${state.name}: placed beside the sway`);
    else if (c.kind === "drop" || state.name === "coasting") assert.equal(placed, true, `${c.kind} ${c.cause} ${c.gapMs} ms, ${state.name}: skipped`);
    else if (!placed) skipped.push(`${c.cause} ${c.gapMs} ${state.name}`);
  }
  assert.ok(skipped.length < 12, `light-only bursts skipped beside their ramp: ${skipped.join("; ")}`);
});

test("no beam differs from the same sweep drawn without the burst: the drawn directions are the same with every burst placed and with none", () => {
  const tokens = tokensFromFile();
  for (const c of cases.filter((x) => x.kind === "drop").slice(0, 6)) {
    const variant = VARIANTS[genName(c.spec)]!;
    const run = (budgetOff: boolean) => {
      const loop = new RigLoop(tokens, budgetOff);
      const out: string[] = [];
      for (let ms = c.fromMs - 6000, i = 0; ms < c.toMs; i++) {
        const d = loop.step(feedAt(ms, { link: { state: "Locked" }, variant }), i === 0 ? 0 : 1 / 60, "High");
        out.push(JSON.stringify(d.drawn));
        ms += d.dtSeconds * 1000;
      }
      return out;
    };
    assert.deepEqual(run(true), run(false), `${c.cause} ${c.gapMs} ms`);
  }
});

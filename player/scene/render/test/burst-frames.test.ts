// Where a burst goes up and what takes its room (scene.md "The flash budget", P1 and the runs' rules): a drop within 1 s of an
// interval change goes up in the change's frame, a phrase flip's sweep keeps a run away at the Beat level, a drop's own fan
// does not keep its burst away, and `budgetOff` is a demo's option, passed nowhere in the product's source.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_CLASS, VARIANTS, feedAt } from "../demo/scenario.ts";
import { RunBudget, dropFrame } from "../src/budget-calc.ts";
import type { Where } from "../src/budget-calc.ts";
import { RigLoop } from "../src/loop.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const tokens = tokensFromFile();

/** The class times (ms) at which a burst goes up, coasting, over a stretch of a variant. */
function burstsAt(variant: string, fromMs: number, toMs: number, state: "Locked" | "Coasting"): number[] {
  const loop = new RigLoop(tokens);
  const out: number[] = [];
  let was = 0;
  for (let ms = fromMs, i = 0; ms < toMs; i++) {
    const d = loop.step(feedAt(ms, { link: { state }, variant: VARIANTS[variant]! }), i === 0 ? 0 : 1 / 60, "High");
    if (d.burst > 0 && was === 0) out.push(ms);
    was = d.burst;
    ms += d.dtSeconds * 1000;
  }
  return out;
}

test("a drop 0.4 s after an interval change goes up in the change's frame, light only (P1)", () => {
  const where: Where = { cls: VARIANTS.collide!.cls, classMs: 39_000, songIndex: 0, songPosMs: 39_000, level: "None" };
  assert.ok(Math.abs(dropFrame(where, 40_400) - 40_000) < 17, "the drop's frame is the change's");
  assert.ok(Math.abs(dropFrame(where, 58_000) - 58_000) < 1e-6, "away from a change it is its own");
  const at = burstsAt("collide", 30_000, 50_000, "Coasting");
  assert.equal(at.length, 1);
  assert.ok(Math.abs(at[0]! - 40_000) < 40, `the burst is in the change frame, not at 40.4 s (${at[0]})`);
});

const flip: Where = { cls: DEMO_CLASS, classMs: 31_000, songIndex: 0, songPosMs: 31_000, level: "Beat" };
const burst = [{ fromMs: 32_100, toMs: 32_300 }];

test("a run wanted just after a phrase flip (32 s) does not fit: the sweep's window is 4.15 s, at every level, since the plan is the song's", () => {
  assert.equal(new RunBudget().admit("a", "lightBurst", burst, flip), false);
  assert.equal(new RunBudget().admit("a", "lightBurst", burst, { ...flip, level: "Tempo only" }), false, "the plan does not depend on the link");
  assert.equal(new RunBudget().admit("a", "lightBurst", [{ fromMs: 34_700, toMs: 34_900 }], flip), false, "still inside the 4.15 s window of the flip");
  assert.equal(new RunBudget().admit("a", "lightBurst", [{ fromMs: 37_100, toMs: 37_300 }], flip), false, "inside the 40 s drop's gather window (36.65 to 39 s)");
  assert.equal(new RunBudget().admit("r", "ramp", [{ fromMs: 35_500, toMs: 36_100 }], flip), false, "a ramp is a run too: none overlaps the window");
});

test("a song change is a sweep, known from the song before it and from the song itself: no burst in its 4.15 s, one 0.15 s after it with the window cut", () => {
  const before: Where = { cls: DEMO_CLASS, classMs: 59_000, songIndex: 0, songPosMs: 59_000, level: "None" };
  const inside = [{ fromMs: 60_500, toMs: 60_700 }];
  assert.equal(new RunBudget().admit("a", "lightBurst", inside, before), false, "seen ahead, from the song's length");
  assert.equal(new RunBudget().admit("a", "lightBurst", inside, { ...before, classMs: 60_400, songIndex: 1, songPosMs: 400 }), false, "seen from the new song");
  const after = new RunBudget();
  assert.equal(after.admit("a", "lightBurst", [{ fromMs: 64_300, toMs: 64_500 }], { ...before, classMs: 63_500, songIndex: 1, songPosMs: 3_500 }), true);
  assert.deepEqual(after.cuts().map((c) => [c.planned.cause, c.planned.fromMs, c.planned.toMs]), [["song change", 60_000, 64_150]]);
});

test("a burst cuts the length of the planned window that comes within 1 s of its decay, and is skipped where its decay lies in one", () => {
  const near: Where = { cls: DEMO_CLASS, classMs: 57_000, songIndex: 0, songPosMs: 57_000, level: "None" };
  const own = new RunBudget();
  assert.equal(own.admit("drop@58000", "dropBurst", [{ fromMs: 58_017, toMs: 58_250 }], near), true, "its own gather ends 1 s before the drop: nothing is cut, and it has no fan turn");
  assert.deepEqual(own.cuts(), []);
  const inFan: Where = { ...near, classMs: 43_000, songPosMs: 43_000 };
  assert.equal(new RunBudget().admit("x", "dropBurst", [{ fromMs: 43_017, toMs: 43_250 }], inFan), false, "no burst in the 40 s drop's fan turn");
  const cut = new RunBudget();
  const after: Where = { ...near, classMs: 79_000, songIndex: 1, songPosMs: 19_000 };
  assert.equal(cut.admit("light@80000", "lightBurst", [{ fromMs: 80_017, toMs: 80_250 }], after), true);
  assert.deepEqual(cut.cuts().map((c) => [c.planned.fromMs, c.planned.toMs, c.counted?.toMs]), [[75_000, 79_150, 79_017]], "song 1's flip at 75 s plans to 79.15 s and is cut to end 1 s before the decay's first frame");
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? sources(join(dir, n)) : n.endsWith(".ts") ? [join(dir, n)] : []));
}

/** The last top-level argument of each `new RigLoop|BurstTracker|RunBudget(...)` call that has two or more, found by matching brackets. */
function lastArgs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/new (?:RigLoop|BurstTracker|RunBudget)\(/g)) {
    let [depth, cur] = [1, ""];
    const args: string[] = [];
    for (let i = (m.index ?? 0) + m[0].length; i < text.length; i++) {
      const c = text.charAt(i);
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      if (depth === 0) break;
      if (c === "," && depth === 1) { args.push(cur.trim()); cur = ""; } else cur += c;
    }
    args.push(cur.trim());
    if (args.length > 1) out.push(args[args.length - 1] ?? "");
  }
  return out;
}

test("source fence: nothing under src/ turns the budget off; only the demo's page does, from its query", () => {
  // A second constructor argument is only the plumbed option, never a literal or a variable holding one.
  const plumbed = new Set(["budgetOff", "options.budgetOff === true"]);
  const files = ["src", "../model/src"].flatMap((d) => sources(join(import.meta.dirname, "..", d)));
  assert.deepEqual(files.flatMap((f) => lastArgs(readFileSync(f, "utf8"))).filter((a) => !plumbed.has(a)), []);
  assert.deepEqual(files.filter((f) => /budgetOff:\s*true/.test(readFileSync(f, "utf8"))), []);
  const main = readFileSync(join(import.meta.dirname, "..", "demo", "main.ts"), "utf8");
  assert.match(main, /budget/);
  // Only the loop, the renderer's options and the tracker take the option; nothing under src/ reads the page's query.
  const reads = sources(join(import.meta.dirname, "..", "src")).filter((f) => /location\.search|URLSearchParams/.test(readFileSync(f, "utf8")));
  assert.deepEqual(reads, []);
});

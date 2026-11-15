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

test("a run wanted just after a phrase flip (32 s) does not fit at the Beat level, where the beams turn; it does where there are no flips", () => {
  assert.equal(new RunBudget().admit("a", "lightBurst", burst, flip), false);
  assert.equal(new RunBudget().admit("a", "lightBurst", burst, { ...flip, level: "Tempo only" }), true);
  assert.equal(new RunBudget().admit("a", "lightBurst", [{ fromMs: 34_700, toMs: 34_900 }], flip), true, "after the 2.5 s sweep");
});

test("a drop's own gather and fan do not keep its burst away; another drop's sweep still does", () => {
  const near: Where = { cls: DEMO_CLASS, classMs: 57_000, songIndex: 0, songPosMs: 57_000, level: "None" };
  const decay = [{ fromMs: 58_017, toMs: 58_250 }];
  assert.equal(new RunBudget().admit("drop@58000", "dropBurst", decay, near), true);
  assert.equal(new RunBudget().admit("other", "dropBurst", decay, near), false, "no burst inside a drop's fan that is not its own");
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

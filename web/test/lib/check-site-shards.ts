// `bash ci.sh check` calls this with the parts of test/spec/site-checks.test.ts from spec-shards.txt
// (`*` for the remainder). It stands in for that file's "covers every state in the table" test,
// which returns early under SPEC_ONLY and so never runs in a shard (issue #438): it fails when a
// state of the table has no 1x shot in any part, or a shot is taken by two parts (it would run twice).
// The shot names repeat how site-checks.test.ts builds SHOTS and site-measure.ts names them
// (`site-<state>-<width>[-text200]`); change all three together.
import { STATES } from "./site-states.ts";

const parts = process.argv.slice(2);
const explicit = parts.filter((p) => p !== "*").map((p) => new RegExp(p));
const hasRest = parts.includes("*");
if (parts.length < 2 || !hasRest) {
  console.error("site-checks must be split in two or more parts with exactly one '*'");
  process.exit(1);
}

const names: { name: string; state: string; zoom: 1 | 2 }[] = STATES.flatMap((s) => [
  ...[390, 1280, ...(s.main ? [820, 320] : [])].map((w) => ({ name: `site-${s.name}-${w}`, state: s.name, zoom: 1 as const })),
  ...[390, 1280].map((w) => ({ name: `site-${s.name}-${w}-text200`, state: s.name, zoom: 2 as const })),
]);

let bad = 0;
const taken = new Set<string>();
for (const n of names) {
  const hits = explicit.filter((r) => r.test(n.name)).length + (explicit.some((r) => r.test(n.name)) ? 0 : 1);
  if (hits !== 1) {
    console.error(`spec-shards: site shot ${n.name} is taken by ${hits} parts`);
    bad = 1;
  }
  if (n.zoom === 1) taken.add(n.state);
}
for (const s of STATES) {
  if (!taken.has(s.name)) {
    console.error(`spec-shards: state ${s.name} has no shot at 1x`);
    bad = 1;
  }
}
if (bad) process.exit(1);
console.log(`spec-shards: ${names.length} site shots, ${STATES.length} states, each shot in exactly one part`);

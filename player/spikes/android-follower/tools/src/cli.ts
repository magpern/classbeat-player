#!/usr/bin/env node
// Replay an Android follower log through spike 1's class clock and print spike 1's pass table.
// usage: node --import tsx src/cli.ts --class <class.json> --log <android.jsonl> [--out <replayed.jsonl>] [--stale-ms 2500]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildPlan } from "../../../music-follower/src/core/class_plan.js";
import { DEFAULT_CONFIG } from "../../../music-follower/src/core/follower.js";
import { parseLog } from "./log.js";
import { replay } from "./replay.js";
import { formatTable, passTable } from "./table.js";

const USAGE = "usage: replay --class <class.json> --log <android.jsonl> [--out <replayed.jsonl>] [--stale-ms 2500]";

function main(): void {
  const { values } = parseArgs({ options: { class: { type: "string" }, log: { type: "string" }, out: { type: "string" }, "stale-ms": { type: "string" } } });
  if (!values.class || !values.log) {
    console.error(USAGE);
    process.exit(2);
  }
  const staleArg = values["stale-ms"];
  if (staleArg !== undefined && !(Number(staleArg) >= 500)) {
    console.error("--stale-ms must be a number of at least 500");
    process.exit(2);
  }
  const plan = buildPlan(JSON.parse(readFileSync(values.class, "utf8")));
  const cfg = { ...DEFAULT_CONFIG, ...(staleArg !== undefined ? { staleMs: Number(staleArg) } : {}) };
  const replayed = replay(plan, parseLog(readFileSync(values.log, "utf8")), cfg);
  if (values.out) writeFileSync(values.out, replayed.lines.join("\n") + "\n");
  console.log(`class: ${plan.name}, crossfade ${plan.crossfadeMs} ms, ${plan.songs.length} songs; ${replayed.steps.length} readings`);
  console.log(formatTable(passTable(plan, replayed)));
  if (values.out) console.log(`spike 1 log with decisions: ${values.out}`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

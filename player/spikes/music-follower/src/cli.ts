#!/usr/bin/env node
// music-follower: poll the Spotify desktop app through the OS, run the class clock prototype,
// and write a JSON-lines log. Keys while running: b = beat tap, m = mark, u = undo, q = quit.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { monoMs, wallMs } from "./clock.js";
import { buildPlan } from "./core/class_plan.js";
import { ClassFollower, DEFAULT_CONFIG } from "./core/follower.js";
import { markerLine, metaLine, readingLine, statusText } from "./core/log_format.js";
import type { Decision } from "./core/types.js";
import { createReader } from "./readers/select.js";

const USAGE = "usage: music-follower --class <class.json> --out <log.jsonl> [--rate 4] [--reader auto|macos|windows|linux]";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      class: { type: "string" },
      out: { type: "string" },
      rate: { type: "string", default: "4" },
      reader: { type: "string", default: "auto" },
      "stale-ms": { type: "string" },
    },
  });
  if (!values.class || !values.out) {
    console.error(USAGE);
    process.exit(2);
  }
  const rate = Math.max(0.5, Number(values.rate));
  const pollMs = 1000 / rate;
  const plan = buildPlan(JSON.parse(readFileSync(values.class, "utf8")));
  const cfg = { ...DEFAULT_CONFIG, ...(values["stale-ms"] ? { staleMs: Number(values["stale-ms"]) } : {}) };
  const reader = createReader(values.reader ?? "auto", pollMs);
  const follower = new ClassFollower(plan, cfg);
  const out = values.out;
  const stamp = () => ({ monoMs: monoMs(), wallMs: wallMs() });
  const write = (line: string) => appendFileSync(out, line + "\n");

  writeFileSync(out, "");
  write(metaLine(stamp(), { event: "start", platform: process.platform, source: reader.source, rate, plan: plan.name, crossfadeMs: plan.crossfadeMs, config: cfg }));

  let last: Decision | null = null;
  let quit = false;
  const finish = () => {
    quit = true;
  };

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const key of chunk) {
      if (key === "\u0003" || key === "q") finish();
      else if (key === "b" || key === "m") write(markerLine(stamp(), key, last?.classTimeMs ?? null));
      else if (key === "u") follower.undo(monoMs());
    }
  });
  process.stdin.resume();

  console.error(`following Spotify, ${rate} Hz, log ${out}. b = beat tap, m = mark, u = undo, q = quit`);
  while (!quit) {
    const started = monoMs();
    const reading = await reader.readNow();
    const decision = follower.step(monoMs(), reading);
    last = decision;
    write(readingLine(stamp(), reading, decision));
    process.stderr.write(`\r${statusText(decision)}                    `);
    await new Promise((r) => setTimeout(r, Math.max(0, pollMs - (monoMs() - started))));
  }
  write(metaLine(stamp(), { event: "end" }));
  reader.close?.();
  process.stdin.pause();
  console.error(`\nlog written: ${out}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

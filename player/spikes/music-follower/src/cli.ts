#!/usr/bin/env node
// music-follower: poll the Spotify desktop app through the OS, run the class clock prototype,
// and write a JSON-lines log. Keys while running: b = beat tap, m = mark, u = undo, r = relink (follow the music again after an undo), 1-9 = pick the song
// number when the link says Ambiguous, q = quit.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { monoMs, wallMs } from "./clock.js";
import { buildPlan } from "./core/class_plan.js";
import { ClassFollower, DEFAULT_CONFIG } from "./core/follower.js";
import { controlLine, markerLine, metaLine, pendingNote, readerErrorLine, readingLine, statusLine } from "./core/log_format.js";
import type { Decision } from "./core/types.js";
import { makeShutdown } from "./shutdown.js";
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
  const rate = Number(values.rate);
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 20) {
    console.error("--rate must be a number from 0.5 to 20");
    process.exit(2);
  }
  const staleArg = values["stale-ms"];
  if (staleArg !== undefined && !(Number(staleArg) >= 500)) {
    console.error("--stale-ms must be a number of at least 500");
    process.exit(2);
  }
  const pollMs = 1000 / rate;
  const plan = buildPlan(JSON.parse(readFileSync(values.class, "utf8")));
  const cfg = { ...DEFAULT_CONFIG, ...(staleArg !== undefined ? { staleMs: Number(staleArg) } : {}) };
  const reader = createReader(values.reader ?? "auto", pollMs, (text) => console.error(`\n${text}`));
  const follower = new ClassFollower(plan, cfg);
  const out = values.out;
  const stamp = () => ({ monoMs: monoMs(), wallMs: wallMs() });
  const write = (line: string) => appendFileSync(out, line + "\n");

  writeFileSync(out, "");
  write(metaLine(stamp(), { event: "start", platform: process.platform, source: reader.source, rate, limitations: reader.limitations ?? [], plan: plan.name, crossfadeMs: plan.crossfadeMs, config: cfg }));

  let last: Decision | null = null;
  let lastError: string | null = null;
  let pendingSince: number | null = null;
  let statusBase = "";
  const finish = makeShutdown(() => {
    write(metaLine(stamp(), { event: "end" }));
    reader.close?.();
    console.error(`\nlog written: ${out}`);
  }, (code) => process.exit(code));
  process.on("SIGINT", finish);
  process.on("SIGTERM", finish);

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const key of chunk) {
      if (key === "\u0003" || key === "q") finish();
      else if (key === "b" || key === "m") write(markerLine(stamp(), key, last?.classTimeMs ?? null));
      else if (key === "u") write(controlLine(stamp(), "undo", (last = follower.undo(monoMs()))));
      else if (key === "r") write(controlLine(stamp(), "relink", (last = follower.relink(monoMs()))));
      else if (key >= "1" && key <= "9") {
        const index = Number(key) - 1;
        if (last?.candidates.includes(index)) {
          follower.pickOccurrence(index);
          write(markerLine(stamp(), `pick:${key}`, last.classTimeMs));
        }
      }
    }
  });
  process.stdin.resume();

  console.error(`following Spotify, ${rate} Hz, log ${out}. b = beat tap, m = mark, u = undo, r = relink, 1-9 = pick song, q = quit`);
  await reader.prepare?.();
  // Keep the status line alive while a read is pending, so it never looks hung.
  setInterval(() => {
    if (pendingSince !== null) process.stderr.write(`\r${statusBase}${pendingNote(monoMs() - pendingSince)}`.padEnd(110));
  }, 250).unref();
  for (;;) {
    const started = monoMs();
    pendingSince = started;
    const reading = await reader.readNow();
    pendingSince = null;
    const err = reader.error?.() ?? null;
    if (err && err !== lastError) {
      write(readerErrorLine(stamp(), err));
      console.error(`\nreader error: ${err}`);
    }
    lastError = err;
    const decision = follower.step(monoMs(), reading);
    last = decision;
    write(readingLine(stamp(), reading, decision));
    statusBase = statusLine(decision, reader.reason?.() ?? null);
    process.stderr.write(`\r${statusBase}`.padEnd(110));
    await new Promise((r) => setTimeout(r, Math.max(0, pollMs - (monoMs() - started))));
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

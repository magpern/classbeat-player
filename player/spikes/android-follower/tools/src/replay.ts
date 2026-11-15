// Replay an Android log through spike 1's follower. The follower is spike 1's own code, imported
// as it is (not ported); this module only feeds it the log's readings and controls in order.
import type { Plan } from "../../../music-follower/src/core/class_plan.js";
import { ClassFollower, DEFAULT_CONFIG } from "../../../music-follower/src/core/follower.js";
import type { FollowerConfig } from "../../../music-follower/src/core/follower.js";
import { controlLine, markerLine, readingLine } from "../../../music-follower/src/core/log_format.js";
import type { Decision, Reading } from "../../../music-follower/src/core/types.js";
import type { LogLine } from "./log.js";

export interface Replayed {
  /** Spike 1 log lines: the input with each reading's decision filled in. */
  lines: string[];
  /** The decisions, one per reading line, with the reading that produced it. */
  steps: { monoMs: number; reading: Reading | null; decision: Decision }[];
  /** Every decision in order, including those from controls. */
  decisions: { monoMs: number; kind: "reading" | "undo" | "relink"; decision: Decision }[];
  markers: { monoMs: number; key: string; classTimeMs: number | null }[];
}

export function replay(plan: Plan, log: LogLine[], cfg: FollowerConfig = DEFAULT_CONFIG): Replayed {
  const follower = new ClassFollower(plan, cfg);
  const out: Replayed = { lines: [], steps: [], decisions: [], markers: [] };
  let last: Decision | null = null;
  for (const l of log) {
    const stamp = { monoMs: l.monoMs, wallMs: l.wallMs };
    if (l.t === "reading") {
      const reading = l.reading ?? null;
      const decision = follower.step(l.monoMs, reading);
      last = decision;
      out.steps.push({ monoMs: l.monoMs, reading, decision });
      out.decisions.push({ monoMs: l.monoMs, kind: "reading", decision });
      out.lines.push(readingLine(stamp, reading, decision));
    } else if (l.t === "control" && (l.key === "undo" || l.key === "relink")) {
      const decision = l.key === "undo" ? follower.undo(l.monoMs) : follower.relink(l.monoMs);
      last = decision;
      out.decisions.push({ monoMs: l.monoMs, kind: l.key, decision });
      out.lines.push(controlLine(stamp, l.key, decision));
    } else if (l.t === "marker" && typeof l.key === "string") {
      const classTimeMs = last?.classTimeMs ?? null;
      out.markers.push({ monoMs: l.monoMs, key: l.key, classTimeMs });
      out.lines.push(markerLine(stamp, l.key, classTimeMs));
    } else {
      out.lines.push(JSON.stringify(l));
    }
  }
  return out;
}

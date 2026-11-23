// What kind of change a new model is against the one on screen (docs/design/room-2d.md, "Every change
// is a step"), which decides how it is placed among the frame marks. Pure.
//   action   a user action, or a timed or outside change that is placed like one: the state, the lights,
//            a link plate, or an interval's content (a seek, a jump, the start, the class's end)
//   switch   the pattern's side changes: the count's switch beat
//   tick     the countdown's second, or with a count running the count's step, and what shows with it
//   null     only what waits for the next mark (class time, the bars line, the score), or nothing
import type { MetricModel, PatternValue, RoomModel } from "./model.ts";

export type ChangeKind = "action" | "switch" | "tick";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const patternOf = (m: RoomModel): PatternValue | null => m.metrics.find((x) => x.pattern)?.pattern ?? null;

/** The metrics without the count's digits (they step on the count's own ticks). */
function withoutCount(metrics: readonly MetricModel[]): unknown {
  return metrics.map((m) => (m.pattern?.kind === "count" ? { ...m, value: "", pattern: { ...m.pattern, count: "" } } : m));
}

function clockRest(m: RoomModel): unknown {
  return m.clock && { ...m.clock, count: "", line: null };
}

export function changeKind(shown: RoomModel, next: RoomModel): ChangeKind | null {
  if (shown.kind !== next.kind || shown.intervalKey !== next.intervalKey || (shown.clock === null) !== (next.clock === null)) return "action";
  if (shown.clock?.pill !== next.clock?.pill || !same(shown.gel, next.gel) || !same(shown.rail.link, next.rail.link)) return "action";
  if (!same(shown.cue, next.cue) || !same(shown.next, next.next) || !same(shown.intro, next.intro)) return "action";
  const [a, b] = [patternOf(shown), patternOf(next)];
  if (a?.kind !== b?.kind || (a && b && "side" in a && "side" in b && a.side !== b.side)) return "switch";
  // With a count running the countdown waits for the count's tick, never early.
  const counted = a?.kind === "count" && b?.kind === "count";
  if (counted ? a.count !== b.count : shown.clock?.count !== next.clock?.count) return "tick";
  if (!same(withoutCount(shown.metrics), withoutCount(next.metrics)) || !same(clockRest(shown), clockRest(next)) || shown.rail.segment !== next.rail.segment) return "tick";
  return null;
}

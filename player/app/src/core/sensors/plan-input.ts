// The interval the panel sets readings against: the open class's current interval and its zone. Pure.
import type { PlanInput } from "./view.ts";
import type { Snapshot } from "../snapshot.ts";

export const NO_PLAN: PlanInput = { interval: null, zone: null };

export function planInputOf(s: Snapshot | null): PlanInput {
  const doc = s?.doc;
  const i = s?.view?.intervalIndex;
  const interval = doc && i !== undefined ? (doc.intervals[i] ?? null) : null;
  if (!doc || !interval) return NO_PLAN;
  return { interval, zone: doc.zone_scale.find((z) => z.zone === interval.zone) ?? null };
}

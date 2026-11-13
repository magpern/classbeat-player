// Where each of the band's buttons sends its press (room-2d.md, "What a press does: the same
// routing as the presenter"), from the same route the commands take (`routeWhileFollowing`), so a
// second line can never promise what the press does not do. Pure. Closed values only: the room
// window is told the kind of route and nothing else of the link.
import type { ClockCommand } from "../commands.ts";
import { routeWhileFollowing } from "../link/while-following.ts";
import type { LinkModel } from "../link/types.ts";

/** "music": the music app is asked; "clock": the clock moves; "handover": the clock moves and stops following. */
export type BandRoute = "music" | "clock" | "handover";

export interface BandRoutes {
  readonly start: BandRoute;
  readonly pause: BandRoute;
  readonly resume: BandRoute;
  readonly next: BandRoute;
  readonly previous: BandRoute;
}

export const BAND_ROUTE_VALUES: readonly BandRoute[] = ["music", "clock", "handover"];

function routeOf(link: LinkModel, available: boolean, cmd: ClockCommand, canSend: boolean): BandRoute {
  const r = routeWhileFollowing(link, available, cmd, canSend);
  if (r === null) return "clock";
  if (r.kind === "manual") return "handover";
  // Start before the first lock asks the music app and also starts the clock: named for the clock.
  return r.alsoClock === true ? "clock" : "music";
}

export function bandRoutes(link: LinkModel, available: boolean, canSend: boolean): BandRoutes {
  const at = (type: "start" | "pause" | "resume" | "next" | "previous"): BandRoute => routeOf(link, available, { type }, canSend);
  return { start: at("start"), pause: at("pause"), resume: at("resume"), next: at("next"), previous: at("previous") };
}

/** The routes as the room window is sent them: rebuilt field by field, each one of the three values. */
export function bandRoutesOf(v: BandRoutes | null): BandRoutes | null {
  if (v === null || typeof v !== "object") return null;
  const one = (x: unknown): BandRoute => (BAND_ROUTE_VALUES.includes(x as BandRoute) ? (x as BandRoute) : "clock");
  return { start: one(v.start), pause: one(v.pause), resume: one(v.resume), next: one(v.next), previous: one(v.previous) };
}

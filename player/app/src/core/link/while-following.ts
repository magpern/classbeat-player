// What the instructor's clock controls mean while the clock follows the music (ADR 0001: the
// music decides where the clock is; "start, pause and next go through the same local interface").
// A control that moved the clock by itself would be undone at the next tick, silently, so each one
// is sent to the music or hands the clock over. Pure: it only names what to do.
import type { ClockCommand } from "../commands.ts";
import type { TransportAction } from "./transport.ts";
import { FOLLOWING } from "./types.ts";
import type { LinkModel } from "./types.ts";

export type Routed =
  /** Not applied to the clock: the music is asked, and the clock follows its answer. */
  | { readonly kind: "transport"; readonly action: TransportAction; readonly alsoClock?: true }
  /** The instructor moves the clock themselves: the link switches to manual, with an announcement. */
  | { readonly kind: "manual" };

/** The announcement shown when a control hands the clock over to the instructor. */
export const HANDOVER_TEXT = "manual clock: following stopped";

const TRANSPORT: Partial<Record<ClockCommand["type"], TransportAction>> = { pause: "pause", resume: "play", start: "play", next: "next" };
const MOVES_THE_CLOCK: readonly ClockCommand["type"][] = ["previous", "jump"];

/**
 * `available` says a reader exists and the class has song timing. Only a link that has locked and
 * is in a following state counts: while coasting or off the list the clock is the instructor's own,
 * and before the first lock only Start reaches the music (and still starts the clock). `canSend` says a transport exists; without one a pause or next
 * can only be done on the clock, which means going manual.
 */
export function routeWhileFollowing(link: LinkModel, available: boolean, cmd: ClockCommand, canSend: boolean): Routed | null {
  if (!available || link.mode !== "following") return null;
  // Follow is picked but nothing has locked yet: Start asks the music app to play and also starts
  // the manual clock, which the first lock then takes over.
  if (!link.everLocked) return cmd.type === "start" && canSend ? { kind: "transport", action: "play", alsoClock: true } : null;
  if (!FOLLOWING.includes(link.state)) return null;
  const action = TRANSPORT[cmd.type];
  if (action !== undefined) return canSend ? { kind: "transport", action } : { kind: "manual" };
  return MOVES_THE_CLOCK.includes(cmd.type) ? { kind: "manual" } : null;
}

/** What the Next and Previous controls say. Provisional until the presenter design spec (#22, #31). */
export interface ControlLabels {
  readonly next: string;
  readonly previous: string;
}

/**
 * The control labels, taken from the same routing as the commands, so a label cannot promise what
 * the route does not do: a control sent to the music is named for the music ("Next song"), one that
 * hands the clock over says it stops following, and one applied to the clock keeps its plain name.
 */
export function controlLabels(link: LinkModel, available: boolean, canSend: boolean): ControlLabels {
  const label = (cmd: ClockCommand, plain: string, music: string): string => {
    const r = routeWhileFollowing(link, available, cmd, canSend);
    if (r === null || (r.kind === "transport" && r.alsoClock === true)) return plain;
    return r.kind === "transport" ? music : `${plain} (stops following)`;
  };
  return { next: label({ type: "next" }, "Next interval", "Next song"), previous: label({ type: "previous" }, "Previous interval", "Previous song") };
}

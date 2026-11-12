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
  | { readonly kind: "transport"; readonly action: TransportAction }
  /** The instructor moves the clock themselves: the link switches to manual, with an announcement. */
  | { readonly kind: "manual" };

/** The announcement shown when a control hands the clock over to the instructor. */
export const HANDOVER_TEXT = "manual clock: following stopped";

const TRANSPORT: Partial<Record<ClockCommand["type"], TransportAction>> = { pause: "pause", resume: "play", next: "next" };
const MOVES_THE_CLOCK: readonly ClockCommand["type"][] = ["previous", "jump"];

/**
 * `available` says a reader exists and the class has song timing. Only a link that has locked and
 * is in a following state counts: before the first lock, and while coasting or off the list, the
 * clock is the instructor's own. `canSend` says a transport exists; without one a pause or next
 * can only be done on the clock, which means going manual.
 */
export function routeWhileFollowing(link: LinkModel, available: boolean, cmd: ClockCommand, canSend: boolean): Routed | null {
  if (!available || link.mode !== "following" || !link.everLocked || !FOLLOWING.includes(link.state)) return null;
  const action = TRANSPORT[cmd.type];
  if (action !== undefined) return canSend ? { kind: "transport", action } : { kind: "manual" };
  return MOVES_THE_CLOCK.includes(cmd.type) ? { kind: "manual" } : null;
}

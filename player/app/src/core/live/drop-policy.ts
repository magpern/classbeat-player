// One drop per press (ADR 0005 section 3; #381). Pure. Once the host sends `drop` for a place,
// that place takes no other drop until the server has answered it, so a second press can never
// drop a phone that took the place in between:
// - "sent": the drop is on its way; Drop is not offered for the place.
// - "queued": the drop was still in the send budget's queue when the connection was lost; it goes
//   again right after the next `welcome` (held-over.ts) and is then "sent".
// - The answer is the server's word that the place is free (`controller_left` `dropped`, or
//   `session_ended` or `free`, after which the server has nothing to drop). A drop sent on a
//   connection that was lost is answered by the replay after the next `welcome`: the place is then
//   rebuilt from the server's word alone (place-policy.ts), and Drop is offered again if it is held.
import type { Slot } from "./host-wire.ts";
import type { Place } from "./session-types.ts";

export type DropState = "none" | "sent" | "queued";
export type Drops = readonly [DropState, DropState];

export const NO_DROPS: Drops = ["none", "none"];

const set = (d: Drops, slot: Slot, s: DropState): Drops => (slot === 1 ? [s, d[1]] : [d[0], s]);

/** Whether a drop for this place may be sent: none is waiting for its answer. */
export const mayDrop = (d: Drops, slot: Slot): boolean => d[slot - 1] === "none";

/** The host sent `drop` for this place. */
export const dropSent = (d: Drops, slot: Slot): Drops => set(d, slot, "sent");

/** The server told the host what holds the place: a free place answers its drop. */
export const placeTold = (d: Drops, slot: Slot, p: Place): Drops => (p === "none" ? set(d, slot, "none") : d);

/** The connection was lost with these drops still unsent: they go after the next `welcome`. */
export const dropsLost = (d: Drops, unsent: readonly Slot[]): Drops => unsent.reduce<Drops>((acc, slot) => set(acc, slot, "queued"), d);

/** A `welcome`: the queued drops go again, first, and are sent; a drop sent before is answered by the replay. */
export function dropsWelcomed(d: Drops): { readonly drops: Drops; readonly resend: readonly Slot[] } {
  const resend = ([1, 2] as const).filter((slot) => d[slot - 1] === "queued");
  const drops: Drops = [d[0] === "queued" ? "sent" : "none", d[1] === "queued" ? "sent" : "none"];
  return { drops, resend };
}

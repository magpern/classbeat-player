// What a lost connection keeps for the next `welcome` (ADR 0005 sections 3 and 10; #353, #381).
// Pure. The send budget's queue goes with a lost connection (main/live/publisher.ts), but two of
// the host's messages must not be lost with it, because each ends something the presenter already
// stopped showing:
// - `cancel_code`: the code the presenter no longer shows would stay valid on the server until it
//   ran out (code-cancel.ts);
// - `drop`: the place the presenter shows free, and the code it no longer shows, would stay held
//   (drop-policy.ts).
// Each goes right after the next `welcome`, ahead of everything else: `cancel_code` first, then the
// drops by place. Nothing else of the queue is kept.
import type { CancelCode } from "../../../../../schema/generated/ts/live-cancel-code.d.ts";
import type { Drop } from "../../../../../schema/generated/ts/live-drop.d.ts";
import { CANCEL_CODE } from "./code-cancel.ts";
import { dropsLost, dropsWelcomed } from "./drop-policy.ts";
import type { Slot } from "./host-wire.ts";
import type { HostOperation, LiveModel } from "./session-types.ts";

/** A message of the lost queue that is sent again after the next `welcome`. */
export type HeldOver = CancelCode | Drop;

/** The messages of a lost queue that are kept, in the queue's order. */
export function heldOver(queue: readonly { readonly type: string }[]): readonly HeldOver[] {
  return queue.filter((q): q is HeldOver => q.type === "cancel_code" || q.type === "drop");
}

/** The model of a session that keeps trying after its connection was lost with `unsent` queued. */
export function keptOnLoss(m: LiveModel, unsent: readonly HeldOver[]): LiveModel {
  const cancel = unsent.some((u) => u.type === "cancel_code");
  const slots = unsent.flatMap((u): Slot[] => (u.type === "drop" && (u.slot === 1 || u.slot === 2) ? [u.slot] : []));
  return { ...m, cancelPending: m.cancelPending || cancel, drops: dropsLost(m.drops, slots) };
}

/** What goes first on the connection a `welcome` lets the host in on; what was pending is then sent. */
export function welcomedFirst(m: LiveModel): { readonly model: LiveModel; readonly first: readonly HostOperation[] } {
  const { drops, resend } = dropsWelcomed(m.drops);
  const first: HostOperation[] = [...(m.cancelPending ? [CANCEL_CODE] : []), ...resend.map((slot): Drop => ({ v: 1, type: "drop", slot }))];
  return { model: { ...m, cancelPending: false, drops }, first };
}

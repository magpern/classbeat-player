// The phone remote's second line on the room band (room-2d.md, "No answer" and "Ended"): "Can't
// reach site" and "Phone remote ended" show until the band next hides, and a note that came while
// the band was hidden shows at its next show and goes at the hide after that. Pure: the band
// (renderer/room-band.ts) tells it what the slot became and when the band moved.
import { lastsUntilHidden, REMOTE_ABSENT } from "./remote.ts";
import type { RemoteView } from "./remote.ts";

export interface NoteMemory {
  /** The slot as the live client last sent it. */
  readonly slot: RemoteView;
  /** Whether its passing note is still to be shown. */
  readonly noted: boolean;
}

export const NO_NOTE: NoteMemory = { slot: REMOTE_ABSENT, noted: false };

/** The slot changed: a note that is new (not the same one again) is to be shown. */
export function slotArrived(n: NoteMemory, v: RemoteView): NoteMemory {
  const fresh = lastsUntilHidden(v) && !(lastsUntilHidden(n.slot) && n.slot.note === v.note);
  return { slot: v, noted: n.noted || fresh };
}

/** The band moved from `wasHidden` to `hidden`: once it hides, whatever note it held is gone; showing keeps it. */
export const bandMoved = (n: NoteMemory, wasHidden: boolean, hidden: boolean): NoteMemory =>
  hidden && !wasHidden ? { slot: n.slot, noted: false } : n;

/** The slot the band draws: a note already gone reads as Off with no second line. */
export const shownSlot = (n: NoteMemory): RemoteView => (lastsUntilHidden(n.slot) && !n.noted ? { slot: "available", note: "none" } : n.slot);

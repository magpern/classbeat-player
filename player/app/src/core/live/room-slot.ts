// The phone remote's slot on the room screen, from the host's live session (room-2d.md, "The class
// code"; ADR 0005 sections 2 and 3). Pure. Built field by field from the phase, the riders' join
// code and how many of the instructor's phones are connected, and nothing else of the session: the
// room window is seen by every rider, so whatever else the session holds never reaches this view.
import type { RemoteView } from "../room/remote.ts";
import type { LiveModel } from "./session-types.ts";

export interface SlotFacts {
  /** Whether this computer is paired: without it there is no phone remote (Absent). */
  readonly paired: boolean;
  readonly classOpen: boolean;
  /** The site the session was started on, for the QR code; the room's filter keeps only an HTTPS origin. */
  readonly site: string | null;
}

/** The slot the room window is sent. Never starts anything: it only reads the session. */
export function roomSlotOf(m: LiveModel, f: SlotFacts): RemoteView {
  if (!f.paired) return { slot: "absent" };
  switch (m.phase) {
    case "idle":
      return f.classOpen ? { slot: "available", note: "none" } : { slot: "absent" };
    case "starting":
    case "connecting":
      // The join code is known while connecting, but it is shown only once the session runs.
      return { slot: "starting" };
    case "live":
    case "reconnecting": {
      const joinCode = m.session?.joinCode;
      if (joinCode === undefined) return { slot: "absent" };
      const phones = m.places.filter((p) => p === "connected").length as 0 | 1 | 2;
      const on = { slot: "on", joinCode, phones, reconnecting: m.phase === "reconnecting" } as const;
      return f.site === null ? on : { ...on, site: f.site };
    }
    case "refused":
      // No answer from the site, or the pairing does not work: Absent, as the spec has it; the
      // presenter, when there is one, says why. Every other refusal can be tried again.
      if (m.refusal === "sessions_full") return { slot: "available", note: "in_use" };
      if (m.refusal === "unreachable" || m.refusal === "not_paired" || m.refusal === "pair_again") return { slot: "absent" };
      return f.classOpen ? { slot: "available", note: "none" } : { slot: "absent" };
    case "ended":
      if (!f.classOpen) return { slot: "absent" };
      // A new class is a new run: its slot starts Off, with no news of the run before.
      return { slot: "available", note: m.ended === "class_changed" ? "none" : "ended" };
  }
}

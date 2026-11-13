// The phone remote's slot as the room window sees it (room-2d.md, "The class code"): its state and,
// while it is on, the riders' join code and how many of the instructor's phones are connected.
// Pure. Nothing else of the live session reaches the room window: never a control code, a token,
// an account, a device or anything about a rider (ADR 0005 sections 2 and 3, rules 13 and 14).

/** The second line under the Phone remote button: none, "In use elsewhere", "Can't reach site" or "Phone remote ended". */
export type RemoteNote = "none" | "in_use" | "unreachable" | "ended";

/** The slot's states: the spec's Absent, Off (`available`, with its second line), Starting, and On with Phone connected and Reconnecting. */
export type RemoteView =
  | { readonly slot: "absent" }
  | { readonly slot: "available"; readonly note: RemoteNote }
  | { readonly slot: "starting" }
  | { readonly slot: "on"; readonly joinCode: string; readonly phones: 0 | 1 | 2; readonly reconnecting: boolean; readonly site?: string };

export const REMOTE_ABSENT: RemoteView = { slot: "absent" };

/** The join code's form (schema/live/v1/session-answer.schema.json, `joinCode`). */
export const JOIN_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

const NOTES: readonly string[] = ["none", "in_use", "unreachable", "ended"];

/** The notes the band shows only until it next hides (room-2d.md, "No answer" and "Ended"). */
export const lastsUntilHidden = (v: RemoteView): v is { readonly slot: "available"; readonly note: "unreachable" | "ended" } =>
  v.slot === "available" && (v.note === "unreachable" || v.note === "ended");

/** The site the QR code points at: an HTTPS origin and nothing more (no path, user, query or fragment). */
export function siteOf(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 100) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.origin === v ? v : null;
}

/** The QR code's address (ADR 0005 section 2): the join code in the fragment and nothing else. */
export const controlAddress = (site: string, joinCode: string): string => `${site}/control#${joinCode}`;

/**
 * What the room window is sent: the view rebuilt field by field, so whatever else the object holds
 * stays behind. A view that is not exactly one of the shapes above is sent as Absent.
 */
export function remoteViewOf(v: RemoteView): RemoteView {
  const r = v as unknown as Record<string, unknown> | null;
  if (r === null || typeof r !== "object") return REMOTE_ABSENT;
  switch (r.slot) {
    case "available":
      return typeof r.note === "string" && NOTES.includes(r.note) ? { slot: "available", note: r.note as RemoteNote } : REMOTE_ABSENT;
    case "starting":
      return { slot: "starting" };
    case "on": {
      const { joinCode, phones, reconnecting } = r;
      if (typeof joinCode !== "string" || !JOIN_CODE.test(joinCode)) return REMOTE_ABSENT;
      if ((phones !== 0 && phones !== 1 && phones !== 2) || typeof reconnecting !== "boolean") return REMOTE_ABSENT;
      // The site is kept only when it is a plain HTTPS origin; without it the band shows no QR code.
      const site = siteOf(r.site);
      return site === null ? { slot: "on", joinCode, phones, reconnecting } : { slot: "on", joinCode, phones, reconnecting, site };
    }
    default:
      return REMOTE_ABSENT;
  }
}

/** Where the slot comes from: the live client (ADR 0005, issue 8), which takes the join code from the session's answer. */
export interface RoomRemote {
  view(): RemoteView;
  /** The instructor's request to start the phone remote (ADR 0005 section 2); never automatic. */
  start(): void;
  stop(): void;
  /** Calls the listener with the slot each time it changes. */
  watch(listener: (v: RemoteView) => void): void;
}

/** This build has no live client: the slot is always absent, and starting or stopping does nothing. */
export const NO_REMOTE: RoomRemote = {
  view: () => REMOTE_ABSENT,
  start: () => undefined,
  stop: () => undefined,
  watch: () => undefined,
};

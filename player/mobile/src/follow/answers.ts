// The follow intents' answers (issue #632), read strictly: native code answers with the fields
// FollowAnswers.kt writes and nothing else, and anything unexpected is an answer that cannot be
// used, never a reading. Pure: no bridge, no clock of its own. A reading carries its own time
// (rule 8): native code says how long ago the music app set the position (`ageMs`), and the page
// dates it on its own clock from the moment of the call.
import type { Observation } from "../../../app/src/core/link/types.ts";

/** What `follow` answered: following, or why not. */
export type FollowState = "following" | "noAccess" | "unavailable";

/** One `reading` answer. */
export type ReadingAnswer =
  | { readonly kind: "reading"; readonly fields: ReadingFields }
  | { readonly kind: "nothing" | "unavailable" | "noAccess" | "stopped" };

export interface ReadingFields {
  readonly trackId: string | null;
  readonly title: string;
  readonly artist: string;
  readonly lengthMs: number | null;
  readonly playing: boolean;
  readonly positionMs: number;
  readonly ageMs: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};
const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The `state` of a one-field answer, or null. */
function stateOf(reply: unknown): unknown {
  return isRecord(reply) && keysAre(reply, ["state"]) ? reply.state : null;
}

/** `follow`'s answer; anything unexpected reads as "unavailable", so the clock stays manual. */
export function parseFollow(reply: unknown): FollowState {
  const s = stateOf(reply);
  return s === "following" || s === "noAccess" ? s : "unavailable";
}

/** `followAccess`'s answer; anything unexpected reads as no access. */
export function parseAccess(reply: unknown): boolean {
  return isRecord(reply) && keysAre(reply, ["granted"]) && reply.granted === true;
}

/**
 * True when `followAccess` says this platform has no music reader at all: {granted: false, state:
 * "unavailable"} (ADR 0016, section 5). Android never sends it; anything else, or an unknown
 * answer, is false, and parseAccess still reads it as no access.
 */
export function parseAccessUnavailable(reply: unknown): boolean {
  return isRecord(reply) && keysAre(reply, ["granted", "state"]) && reply.granted === false && reply.state === "unavailable";
}

/** A command's answer (FollowAnswers.kt): taken or not by the music app, or why nothing was sent. */
export type CommandState = "sent" | "notSent" | "stopped" | "noAccess";

/** `sendPlay`, `sendPause` or `sendNext`'s answer, or null when it cannot be used. */
export function parseCommand(reply: unknown): CommandState | null {
  const s = stateOf(reply);
  return s === "sent" || s === "notSent" || s === "stopped" || s === "noAccess" ? s : null;
}

const FIELDS = ["trackId", "title", "artist", "lengthMs", "playing", "positionMs", "ageMs"] as const;

function parseFields(v: unknown): ReadingFields | null {
  if (!isRecord(v) || !keysAre(v, FIELDS)) return null;
  const { trackId, title, artist, lengthMs, playing, positionMs, ageMs } = v;
  if (typeof title !== "string" || typeof artist !== "string" || typeof playing !== "boolean") return null;
  if (!(trackId === null || (typeof trackId === "string" && trackId !== ""))) return null;
  if (!(lengthMs === null || (count(lengthMs) && lengthMs > 0))) return null;
  if (!count(positionMs) || !count(ageMs)) return null;
  if (title === "" && trackId === null) return null;
  return { trackId, title, artist, lengthMs, playing, positionMs, ageMs };
}

/** `reading`'s answer, or null when it cannot be used. */
export function parseReading(reply: unknown): ReadingAnswer | null {
  if (!isRecord(reply)) return null;
  if (reply.state === "reading" && keysAre(reply, ["state", "reading"])) {
    const fields = parseFields(reply.reading);
    return fields === null ? null : { kind: "reading", fields };
  }
  const s = stateOf(reply);
  return s === "nothing" || s === "unavailable" || s === "noAccess" || s === "stopped" ? { kind: s } : null;
}

/**
 * The music link's reading. `calledAt` is when the call that got it began and `answeredAt` when
 * its answer came: native code measured `ageMs` between the two, so the position was set no later
 * than `answeredAt - ageMs` and no earlier than `calledAt - ageMs`. The midpoint is taken, as the
 * desktop followers date theirs. A call whose times run backwards cannot be dated: null.
 */
export function observationOf(f: ReadingFields, calledAt: number, answeredAt: number): Observation | null {
  if (!Number.isFinite(calledAt) || !Number.isFinite(answeredAt) || answeredAt < calledAt) return null;
  const mid = (calledAt + answeredAt) / 2;
  return { trackId: f.trackId, title: f.title, artist: f.artist, lengthMs: f.lengthMs, playing: f.playing, positionMs: f.positionMs, at: mid - f.ageMs, seenAt: answeredAt };
}

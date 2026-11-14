// Why the macOS read gave no reading (issue #458), told from what osascript did. Pure.
// -1743 is Automation refused by the person or by macOS, -600 is Spotify not running (it quit
// between the check and the read), and anything else that exits with an error (a script that does
// not compile is -2741) is a script failure. A call that was killed at its limit is "not answering".
import type { NoReadingReason } from "./reader.ts";

const REFUSED = /\(-1743\)|not authori[sz]ed to send apple events/i;
const NOT_RUNNING = /\(-600\)|application isn.t running/i;

/** The text an osascript failure carries: the error's message and its stderr, when it has one. */
function failureText(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { message, stderr } = error as { message?: unknown; stderr?: unknown };
  return `${typeof message === "string" ? message : ""}\n${typeof stderr === "string" ? stderr : ""}`;
}

/** The reason for a failed call. `error` is whatever execFile reported. */
export function reasonForFailure(error: unknown): NoReadingReason {
  const text = failureText(error);
  if (REFUSED.test(text)) return "not-permitted";
  if (NOT_RUNNING.test(text)) return "not-running";
  const e = (typeof error === "object" && error !== null ? error : {}) as { killed?: unknown; signal?: unknown };
  if (e.killed === true || (typeof e.signal === "string" && e.signal !== "")) return "not-answering";
  return "script-failed";
}

/** A line for the status; the not-permitted one names the System Settings path. */
export function describeReason(reason: NoReadingReason): string {
  switch (reason) {
    case "not-running":
      return "Spotify is not running.";
    case "not-permitted":
      return "macOS has not allowed this app to control Spotify. Switch it on in System Settings, Privacy & Security, Automation, this app, Spotify.";
    case "not-answering":
      return "Spotify is not answering.";
    case "script-failed":
      return "Reading Spotify failed.";
  }
}

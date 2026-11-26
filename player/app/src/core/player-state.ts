// The shell's state: the open class, its clock and the last file error. The reducers are in
// player-reducers.ts; this module adds reading a class file's text (class-file.ts), which only the
// desktop shell does. Pure; the shell holds the state and passes a monotonic `now`.
import { readClassText } from "./class-file.ts";
import { openDocument } from "./player-reducers.ts";
import type { PlayerState } from "./player-reducers.ts";

export * from "./player-reducers.ts";

/**
 * Opens a class file's text. A valid class replaces the open one with a fresh clock; a refused
 * file leaves the open class and its clock exactly as they were (ADR 0003 section 7: the player
 * keeps playing its other classes) and records the message. `following` says a reader exists;
 * with `followAtOnce` false the class opens on the manual clock until the instructor picks Follow.
 */
export function openText(s: PlayerState, fileName: string, text: string, classSchema: unknown, now: number, following = false, followAtOnce = following): PlayerState {
  const r = readClassText(text, classSchema);
  if (!r.ok) return { ...s, error: { message: r.message, details: r.details } };
  return openDocument(s, fileName, r.doc, now, following, followAtOnce);
}

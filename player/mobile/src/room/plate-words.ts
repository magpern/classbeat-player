// The plate the class list shows when the room screen could not open a class (issue #871). The
// room screen goes back to the list with one of these closed names in the address's fragment; the
// list shows that name's fixed words, and any other fragment shows nothing. The words are the
// existing ones: /play's "Class not found" (play.md) and the class-format reader's messages
// (core/class-file.ts; a test keeps them equal, so the list's bundle need not carry the reader).
// Nothing from the class or the address becomes a word. Pure.

/** Why no class opened. */
export type NoClass = "missing" | "invalid" | "newer";

export interface PlateWords {
  readonly head: string;
  readonly detail: string;
}

export const PLATE_WORDS: Readonly<Record<NoClass, PlateWords>> = {
  missing: { head: "That class is not here", detail: "It may have been deleted." },
  invalid: { head: "That class cannot be opened", detail: "This class file is not valid." },
  newer: { head: "That class cannot be opened", detail: "This class needs a newer version of the player." },
};

const PREFIX = "#class-";

/** The class list's address after a class did not open. */
export const listAfter = (why: NoClass): string => `instructor.html${PREFIX}${why}`;

/** The plate for a fragment, or null for any fragment that is not exactly one of the names. */
export function plateFor(hash: string): PlateWords | null {
  if (!hash.startsWith(PREFIX)) return null;
  const name = hash.slice(PREFIX.length);
  return Object.hasOwn(PLATE_WORDS, name) ? PLATE_WORDS[name as NoClass] : null;
}

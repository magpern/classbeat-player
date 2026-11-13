// The short codes the phone types or reads from its address (docs/design/companion.md, "Getting
// control"; schema/live/README.md, choice 2). Pure: no DOM, no I/O.
//
// A code is 8 letters of ADR 0002's alphabet, shown and sent as `XXXX-XXXX`. What the instructor
// types is normalised first (case, spaces and hyphens are ignored); anything else never goes out.

const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const SHORT_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
/** Longer than any fragment the page is given: such a fragment is not read at all. */
const MAX_FRAGMENT = 40;

/** The typed text as a code in its shown form, or null when it is not 8 letters of the alphabet. */
export function normaliseCode(typed: string): string | null {
  if (typed.length > MAX_FRAGMENT) return null;
  const letters = typed.replace(/[\s-]/g, "").toUpperCase();
  if (letters.length !== 8 || [...letters].some((c) => !ALPHABET.includes(c))) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export interface Fragment {
  /** The class (join) code: it only names the session and gives no control (rule 14). */
  readonly join: string | null;
  /** The one-time control code from the presenter window's QR code, if there was one. */
  readonly control: string | null;
}

const NOTHING: Fragment = { join: null, control: null };

/**
 * What `/control#<join code>` or `/control#<join code>.<control code>` carries. A fragment of any
 * other form gives nothing; a control code without a valid join code is dropped too.
 */
export function parseFragment(hash: string): Fragment {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "" || raw.length > MAX_FRAGMENT) return NOTHING;
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return NOTHING;
  }
  const parts = text.split(".");
  if (parts.length > 2) return NOTHING;
  const join = normaliseCode(parts[0] ?? "");
  if (join === null) return NOTHING;
  if (parts.length === 1) return { join, control: null };
  return { join, control: normaliseCode(parts[1] ?? "") };
}

/** The field's text while typing: upper case, at most 8 letters, a hyphen after the fourth. */
export function shownWhileTyping(typed: string): string {
  const letters = typed.replace(/[\s-]/g, "").toUpperCase().slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

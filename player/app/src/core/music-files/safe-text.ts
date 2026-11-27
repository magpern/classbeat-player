// Text from a class document shown on the instructor's screen as plain text (ADR 0017 section 2).
// The format's `file_name` refuses only `/` and `\`, so a document can carry control characters, NUL,
// line breaks and bidirectional overrides; each is replaced by U+FFFD before the text is shown, so
// a name cannot reorder the words around it or break a line it did not own. Pure. The page still
// sets text only through `textContent`, never markup.

/** The replacement character U+FFFD, written as a code point so no invisible character is in this file. */
export const REPLACEMENT = String.fromCodePoint(0xfffd);

/**
 * Code point ranges that are replaced: C0 controls (NUL, tab, line breaks), DEL and C1 controls,
 * the Arabic letter mark, zero-width characters and the left-to-right and right-to-left marks
 * (200B to 200F), the line and paragraph separators and every bidi embedding and override
 * (2028 to 202E), the word joiner and the bidi isolates (2060 to 2069), and the byte order mark.
 */
const UNSAFE: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];

const unsafe = (cp: number): boolean => UNSAFE.some(([lo, hi]) => cp >= lo && cp <= hi);

/** The text with every unsafe character replaced; other text is returned as it is. */
export const safeText = (text: string): string => Array.from(text, (ch) => (unsafe(ch.codePointAt(0) ?? 0) ? REPLACEMENT : ch)).join("");

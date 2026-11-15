// Text helpers for the source guard: pure string functions, no I/O.

/** A Kotlin char literal: 'x', '"', '\n', '\'' or 'A'. */
const CHAR_LITERAL = /^'(?:\\u[0-9a-fA-F]{4}|\\.|[^\\'\n])'/;

/** Removes comments but keeps string and char literals (so a `//` inside "https://..." survives). */
export function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    const chr = c === "'" ? CHAR_LITERAL.exec(src.slice(i, i + 8)) : null;
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const stop = end < 0 ? src.length : end + 3;
      out += src.slice(i, stop);
      i = stop;
    } else if (chr) {
      // Kept whole, so a quote inside it (`'"'`) does not open a string.
      out += chr[0];
      i += chr[0].length;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export const stripXmlComments = (x: string) => x.replace(/<!--[\s\S]*?-->/g, "");

/** Counts the matches of a global pattern. */
export const countMatches = (text: string, re: RegExp) => [...text.matchAll(re)].length;

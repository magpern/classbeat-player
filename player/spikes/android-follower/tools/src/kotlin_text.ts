// Text helpers for the source guard: pure string functions, no I/O.

/** A Kotlin char literal: 'x', '"', '\n', '\'' or 'A'. */
const CHAR_LITERAL = /^'(?:\\u[0-9a-fA-F]{4}|\\.|[^\\'\n])'/;

/** Removes comments but keeps string and char literals (so a `//` inside "https://..." survives). */
export function stripComments(src: string): string {
  return code(src, 0, false)[0];
}

/** Code from `i`; inside a `${ ... }` template it stops at the template's closing brace (left for the caller). */
function code(src: string, from: number, inTemplate: boolean): [string, number] {
  let out = "";
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const c = src[i]!;
    const chr = c === "'" ? CHAR_LITERAL.exec(src.slice(i, i + 8)) : null;
    if (src.startsWith('"""', i)) {
      const [s, next] = text(src, i + 3, true);
      out += '"""' + s;
      i = next;
    } else if (chr) {
      // Kept whole, so a quote inside it (`'"'`) does not open a string.
      out += chr[0];
      i += chr[0].length;
    } else if (c === '"') {
      const [s, next] = text(src, i + 1, false);
      out += '"' + s;
      i = next;
    } else if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      out += " ";
    } else if (inTemplate && c === "}" && depth === 0) {
      return [out, i];
    } else {
      depth += c === "{" ? 1 : c === "}" ? -1 : 0;
      out += c;
      i++;
    }
  }
  return [out, i];
}

/** The inside of a string from `from`, closing quote included; each `${ ... }` is code, so a nested `"/*"` stays in its own string. */
function text(src: string, from: number, raw: boolean): [string, number] {
  let out = "";
  let i = from;
  while (i < src.length) {
    if (raw ? src.startsWith('"""', i) : src[i] === '"') {
      const len = raw ? 3 : 1;
      return [out + src.slice(i, i + len), i + len];
    }
    if (src.startsWith("${", i)) {
      const [inner, next] = code(src, i + 2, true);
      out += "${" + inner + (next < src.length ? "}" : "");
      i = next + 1;
    } else {
      const step = !raw && src[i] === "\\" ? 2 : 1;
      out += src.slice(i, i + step);
      i += step;
    }
  }
  return [out, i];
}

export const stripXmlComments = (x: string) => x.replace(/<!--[\s\S]*?-->/g, "");

/** Counts the matches of a global pattern. */
export const countMatches = (text: string, re: RegExp) => [...text.matchAll(re)].length;

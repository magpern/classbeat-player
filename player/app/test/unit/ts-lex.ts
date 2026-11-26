// A small TypeScript, CSS and markup lexer for the rule guards: each source with its real comments
// removed and nothing else lost. Strings, template literals and regular expressions are kept whole,
// so a comment marker inside one ("//", "/*", "<!--") hides no code after it (issue #861).

// A "/" after one of these words starts a regular expression; after any other word, a division.
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const WORD = /[\p{L}\p{N}_$]/u;
// A ")" that closes the condition after one of these words ends no operand: `if (x) /re/` is a regex.
const BEFORE_CONDITION = new Set(["if", "while", "for", "with"]);

/** TypeScript or JavaScript with its comments removed; strings, templates and regexes kept whole. */
export function jsSource(src: string): string {
  let i = 0;
  const out: string[] = [];
  // For each "(" still open, whether it opens the condition of `if`, `while`, `for` or `with`; and
  // whether the last ")" closed such a condition.
  const conditions: boolean[] = [];
  let closedCondition = false;

  // The last few characters of the code so far, trailing blanks out.
  function before(): string {
    let text = "";
    for (let k = out.length - 1; k >= 0 && text.trimStart().length < 16; k--) text = out[k] + text;
    return text.trimEnd();
  }

  // The word the code so far ends with, or "" when it ends with a property name (`a.if`) or no word.
  function lastWord(text: string): string {
    const m = /(\.?)\s*([\p{L}\p{N}_$]+)$/u.exec(text);
    return m && !m[1] ? m[2]! : "";
  }

  // Whether a "/" here starts a regular expression: what came before it cannot end an operand.
  function regexAllowed(): boolean {
    const text = before();
    const last = text.at(-1);
    if (last === undefined) return true;
    if (last === ")") return closedCondition;
    if (last === "]" || last === "}") return false;
    if (!WORD.test(last)) return true;
    return BEFORE_REGEX.has(/[\p{L}\p{N}_$]+$/u.exec(text)?.[0] ?? "");
  }

  // Copies a quoted run up to its closing quote (or the line's end), escapes kept as they are.
  function quoted(close: string, stopAtLine: boolean): void {
    out.push(src[i++]!);
    while (i < src.length && src[i] !== close && !(stopAtLine && src[i] === "\n")) {
      if (src[i] === "\\") out.push(src[i++]!);
      if (i < src.length) out.push(src[i++]!);
    }
    if (src[i] === close) out.push(src[i++]!);
  }

  function regex(): void {
    out.push(src[i++]!);
    let inClass = false;
    while (i < src.length && src[i] !== "\n") {
      const ch = src[i]!;
      if (ch === "\\") {
        out.push(src[i++]!);
        if (i < src.length && src[i] !== "\n") out.push(src[i++]!);
        continue;
      }
      out.push(ch);
      i++;
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) return;
    }
  }

  function template(): void {
    out.push(src[i++]!);
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") {
        out.push(src[i++]!);
        if (i < src.length) out.push(src[i++]!);
      } else if (src.startsWith("${", i)) {
        out.push("${");
        i += 2;
        code(true);
      } else out.push(src[i++]!);
    }
    if (src[i] === "`") out.push(src[i++]!);
  }

  function code(inTemplate: boolean): void {
    let depth = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (src.startsWith("//", i)) {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (src.startsWith("/*", i)) {
        const end = src.indexOf("*/", i + 2);
        i = end < 0 ? src.length : end + 2;
        out.push(" ");
      } else if (ch === '"' || ch === "'") quoted(ch, true);
      else if (ch === "`") template();
      else if (ch === "/" && regexAllowed()) regex();
      else {
        if (ch === "(") conditions.push(BEFORE_CONDITION.has(lastWord(before())));
        if (ch === ")") closedCondition = conditions.pop() ?? false;
        if (inTemplate && ch === "{") depth++;
        if (inTemplate && ch === "}") {
          if (depth === 0) {
            out.push(src[i++]!);
            return;
          }
          depth--;
        }
        out.push(ch);
        i++;
      }
    }
  }

  code(false);
  return out.join("");
}

/** CSS with its comments removed; strings kept whole, so a "/*" in one hides nothing. */
export function cssSource(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      out += " ";
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** HTML or XML with its `<!-- … -->` comments removed and nothing else: "//" and "/*" are text there. */
export const markupSource = (src: string): string => src.replace(/<!--[\s\S]*?(?:-->|$)/g, " ");

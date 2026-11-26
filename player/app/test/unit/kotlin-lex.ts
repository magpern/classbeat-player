// A small Kotlin lexer for the rule guards: what the compiler sees as code, with comments and the
// text of string literals removed but every template expression (`$name`, `${…}`) kept, so a
// guard cannot be passed by hiding code in a string template or a string in a comment, or a
// comment marker in a string.

const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

/**
 * The source with comments removed (nested block comments too), each string and character
 * literal emptied to `""` or `''`, the contents of its templates kept in its place, and backticks
 * dropped from quoted names. With `literals`, each string's text (its templates left out) is pushed
 * there and the string ends in `#<index>"`, so a value can be pinned to the code that holds it.
 */
export function kotlinCode(src: string, literals?: string[]): string {
  let i = 0;
  const out: string[] = [];

  function code(inTemplate: boolean): void {
    let depth = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (src.startsWith("//", i)) {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (src.startsWith("/*", i)) {
        let d = 0;
        do {
          const step = src.startsWith("/*", i) ? 1 : src.startsWith("*/", i) ? -1 : 0;
          d += step;
          i += step === 0 ? 1 : 2;
        } while (d > 0 && i < src.length);
        out.push(" ");
      } else if (src.startsWith('"""', i)) {
        i += 3;
        string(true);
      } else if (ch === '"') {
        i++;
        string(false);
      } else if (ch === "'") {
        i++;
        while (i < src.length && src[i] !== "'" && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
        i++;
        out.push("''");
      } else if (ch === "`") {
        i++;
        while (i < src.length && src[i] !== "`" && src[i] !== "\n") out.push(src[i++]!);
        i++;
      } else {
        if (inTemplate && ch === "{") depth++;
        if (inTemplate && ch === "}") {
          if (depth === 0) {
            i++;
            return;
          }
          depth--;
        }
        out.push(ch);
        i++;
      }
    }
  }

  function string(raw: boolean): void {
    out.push('"');
    let text = "";
    const close = (): void => {
      out.push(literals ? `#${literals.push(text) - 1}"` : '"');
    };
    while (i < src.length) {
      if (raw ? src.startsWith('"""', i) : src[i] === '"') {
        i += raw ? 3 : 1;
        while (raw && src[i] === '"') {
          text += '"';
          i++;
        }
        close();
        return;
      }
      if (!raw && src[i] === "\n") break;
      if (!raw && src[i] === "\\") {
        text += src.slice(i, i + 2);
        i += 2;
      } else if (src.startsWith("${", i)) {
        i += 2;
        out.push(" ");
        code(true);
        out.push(" ");
      } else if (src[i] === "$" && src[i + 1] === "`") {
        i += 2;
        out.push(" ");
        while (i < src.length && src[i] !== "`" && src[i] !== "\n") out.push(src[i++]!);
        i++;
        out.push(" ");
      } else if (src[i] === "$" && NAME_START.test(src[i + 1] ?? "")) {
        i++;
        out.push(" ");
        while (NAME_PART.test(src[i] ?? "")) out.push(src[i++]!);
        out.push(" ");
      } else text += src[i++];
    }
    close();
  }

  code(false);
  return out.join("");
}

/**
 * The source with its comments removed and nothing else lost: kotlinCode's output with each
 * string's text put back between its quotes (after the string's template expressions, which stay
 * in place). A check reads the code and the strings' contents, and no comment marker in a string
 * hides the code after it.
 */
export function kotlinSource(src: string): string {
  const literals: string[] = [];
  return kotlinCode(src, literals).replace(/#(\d+)"/g, (pin: string, n: string) => {
    const text = literals[Number(n)];
    return text === undefined ? pin : `${text}"`;
  });
}

/** Every name in the code as the lexer above leaves it, any letters (numbers' suffixes are not names). */
export function kotlinNames(src: string): string[] {
  return [...kotlinCode(src).matchAll(/(?<![\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*/gu)].map((m) => m[0]);
}

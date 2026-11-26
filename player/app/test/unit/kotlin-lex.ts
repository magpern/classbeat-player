// A small Kotlin lexer for the rule guards: what the compiler sees as code, with comments and the
// text of string literals removed but every template expression (`$name`, `${…}`) kept, so a
// guard cannot be passed by hiding code in a string template or a string in a comment, or a
// comment marker in a string.

/**
 * The source with comments removed (nested block comments too), each string and character
 * literal emptied to `""` or `''`, the contents of its templates kept in its place, and backticks
 * dropped from quoted names.
 */
export function kotlinCode(src: string): string {
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
    while (i < src.length) {
      if (raw ? src.startsWith('"""', i) : src[i] === '"') {
        i += raw ? 3 : 1;
        while (raw && src[i] === '"') i++;
        out.push('"');
        return;
      }
      if (!raw && src[i] === "\n") break;
      if (!raw && src[i] === "\\") i += 2;
      else if (src.startsWith("${", i)) {
        i += 2;
        out.push(" ");
        code(true);
        out.push(" ");
      } else if (src[i] === "$" && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
        i++;
        out.push(" ");
        while (/\w/.test(src[i] ?? "")) out.push(src[i++]!);
        out.push(" ");
      } else i++;
    }
    out.push('"');
  }

  code(false);
  return out.join("");
}

/** Every name in the code as the lexer above leaves it (numbers' suffixes are not names). */
export function kotlinNames(src: string): string[] {
  return [...kotlinCode(src).matchAll(/(?<!\w)[A-Za-z_]\w*/g)].map((m) => m[0]);
}

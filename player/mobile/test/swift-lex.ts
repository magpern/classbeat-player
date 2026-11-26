// A small Swift lexer for the iOS rule guards (issue #894): the source with its comments removed
// (nested block comments too) and nothing else lost. String literals, raw strings (#"…"#) and
// multi-line strings are kept whole, interpolations (\( … ), \#( … )) read as code, so a guard
// reads the code and the strings' contents, and no comment marker inside a string hides the code
// after it.

const RAW_OPEN = /#+(?=")/y;

export function swiftSource(src: string): string {
  let i = 0;
  const out: string[] = [];

  function code(inInterpolation: boolean): void {
    let depth = 0;
    while (i < src.length) {
      RAW_OPEN.lastIndex = i;
      const raw = RAW_OPEN.exec(src);
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
      } else if (raw) {
        string(raw[0].length);
      } else if (src[i] === '"') {
        string(0);
      } else {
        const ch = src[i]!;
        if (inInterpolation && ch === "(") depth++;
        if (inInterpolation && ch === ")") {
          if (depth === 0) {
            out.push(ch);
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

  function string(hashes: number): void {
    const pounds = "#".repeat(hashes);
    const multi = src.startsWith('"""', i + hashes);
    const quote = multi ? '"""' : '"';
    const close = quote + pounds;
    const escape = "\\" + pounds;
    const open = pounds + quote;
    out.push(open);
    i += open.length;
    while (i < src.length) {
      if (src.startsWith(close, i)) {
        out.push(close);
        i += close.length;
        return;
      }
      if (!multi && src[i] === "\n") return;
      if (src.startsWith(escape + "(", i)) {
        out.push(escape + "(");
        i += escape.length + 1;
        code(true);
      } else if (src.startsWith(escape, i)) {
        out.push(src.slice(i, i + escape.length + 1));
        i += escape.length + 1;
      } else out.push(src[i++]!);
    }
  }

  code(false);
  return out.join("");
}

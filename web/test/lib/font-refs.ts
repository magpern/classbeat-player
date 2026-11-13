// Remote font references in a CSS or HTML text, for the web lane's guard (test/unit/design.test.ts):
// a remote url() in an @font-face block, a remote @import, a remote <link href>.
//
// The structure is found in the raw text, the way the CSS and HTML tokenizers find it: a keyword may
// be written with CSS escapes, a brace inside a string, an escape or a comment does not close an
// @font-face block, and a `>` inside a quoted attribute does not end a <link> tag. Only a captured
// value is decoded (CSS escapes in a CSS value, character references in an href), never the whole
// text, so a decoded character never moves the structure (#276, B1). Every value is then read as
// the URL parser reads it.

/** Leaves the page: `http:` or `https:` with or without slashes, or protocol-relative (the URL parser reads `\` as `/`). */
const REMOTE = /^(?:https?:|[/\\]{2})/i;

/** The URL parser's clean-up: C0 controls and spaces (and, to be safe, any other white space) trimmed at both ends, tab and newline removed anywhere. */
export function urlInput(value: string): string {
  const blank = (c: string): boolean => c.charCodeAt(0) <= 0x20 || /\s/.test(c);
  let a = 0;
  let b = value.length;
  while (a < b && blank(value[a])) a += 1;
  while (b > a && blank(value[b - 1])) b -= 1;
  return value.slice(a, b).replace(/[\t\n\r]/g, "");
}

/** Decodes the CSS escapes of one captured value: `\68 ttps` is `https`, `\/` is `/`; CRLF, CR and FF count as LF and a backslash-newline is a continuation. */
export function decodeCssEscapes(value: string): string {
  return value
    .replace(/\r\n|[\r\f]/g, "\n")
    .replace(/\\\n/g, "")
    .replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|([^\n0-9a-f]))/gi, (_m, hex?: string, ch?: string) => {
      if (ch !== undefined) return ch;
      const cp = parseInt(hex ?? "0", 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
    });
}

/** Decodes the HTML character references an attribute value may use: `&#x68;ttps`, `&#104;`, `&colon;`, `&sol;`, `&bsol;`, `&Tab;`, `&NewLine;`. */
export function decodeHtmlRefs(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/")
    .replace(/&bsol;/gi, "\\")
    .replace(/&Tab;/gi, "\t")
    .replace(/&NewLine;/gi, "\n")
    .replace(/&amp;/gi, "&");
}

/** One letter of a CSS keyword as CSS reads it: the letter in either case, its hex escape, or the letter escaped (unless it is a hex digit, whose escape is a code point). */
function cssLetter(c: string): string {
  const codes = [...new Set([c.toLowerCase(), c.toUpperCase()])].map((x) => (x.codePointAt(0) ?? 0).toString(16));
  const hex = `\\\\0{0,4}(?:${codes.join("|")})(?:\\r\\n|[ \\t\\n\\r\\f])?`;
  return /[0-9a-f]/i.test(c) ? `(?:${c}|${hex})` : `(?:${c}|${hex}|\\\\${c})`;
}

/** A CSS keyword, any of whose letters may be escaped (`\75rl`, `@\69mport`, `@font\-face`). */
const keyword = (word: string): string => [...word].map(cssLetter).join("");

// A CSS token that may hold escapes: a hex escape swallows one whitespace after it, so it is matched whole.
const cssToken = (stop: string): string => `(?:\\\\[0-9a-f]{1,6}(?:\\r\\n|[ \\t\\n\\r\\f])?|\\\\(?:\\r\\n|[\\s\\S])|[^${stop}\\\\])+`;
// A quoted CSS string, captured whole (a tab in it reaches the URL parser); an unescaped newline ends it.
const cssString = (q: string): string => `${q}((?:[^${q}\\\\\\n\\r\\f]|\\\\(?:\\r\\n|[\\s\\S]))*)`;
const value = (stop: string): string => `(?:${cssString('"')}|${cssString("'")}|(${cssToken(stop)}))`;
const COMMENTS = "(?:\\s|/\\*[\\s\\S]*?\\*/)*";
// The body runs to the first `}` outside a string, an escape or a comment (or to the end of the text).
const FONT_FACE = new RegExp(`@${keyword("font-face")}${COMMENTS}\\{(?:${cssString('"')}"?|${cssString("'")}'?|/\\*[\\s\\S]*?(?:\\*/|$)|\\\\[\\s\\S]|[^}"'\\\\])*`, "gi");
const FONT_URL = new RegExp(`${keyword("url")}\\(\\s*${value(`)"'\\s`)}`, "gi");
const IMPORT = new RegExp(`@${keyword("import")}${COMMENTS}(?:${keyword("url")}\\(\\s*)?${value(`)"';\\s`)}`, "gi");

const HTML_SPACE = new Set([" ", "\t", "\n", "\f", "\r"]);

/** The attributes of the start tag whose name ends at `from`, read as the HTML tokenizer reads them; a `>` inside a quoted value does not end the tag. */
export function tagAttributes(html: string, from: number): { name: string; value: string }[] {
  const attrs: { name: string; value: string }[] = [];
  const space = (i: number): boolean => HTML_SPACE.has(html[i]);
  let i = from;
  for (;;) {
    while (i < html.length && (space(i) || html[i] === "/")) i += 1;
    if (i >= html.length || html[i] === ">") return attrs;
    let name = html[i]; // the first character may be `=`
    i += 1;
    while (i < html.length && !space(i) && html[i] !== "/" && html[i] !== ">" && html[i] !== "=") name += html[i++];
    while (i < html.length && space(i)) i += 1;
    let v = "";
    if (html[i] === "=") {
      i += 1;
      while (i < html.length && space(i)) i += 1;
      const q = html[i];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, i + 1);
        v = html.slice(i + 1, end < 0 ? html.length : end);
        i = end < 0 ? html.length : end + 1;
      } else {
        while (i < html.length && !space(i) && html[i] !== ">") v += html[i++];
      }
    }
    attrs.push({ name: name.toLowerCase(), value: v });
  }
}

/** Every href of a <link>: each `href` attribute as the tokenizer reads the tag, and what the earlier, simpler pattern saw (kept, so nothing it caught is lost). */
function linkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const m of text.matchAll(/<link\b/gi)) {
    for (const a of tagAttributes(text, (m.index ?? 0) + m[0].length)) if (a.name === "href") hrefs.push(a.value);
    const plain = /\bhref\s*=\s*["']?\s*([^"'\s>]+)/i.exec(/^<link\b[^>]*>/i.exec(text.slice(m.index))?.[0] ?? "");
    if (plain) hrefs.push(plain[1]);
  }
  return hrefs;
}

/** The remote font references in a CSS or HTML text, each as the URL parser would read it. */
export function remoteFontRefs(text: string): string[] {
  const found: string[] = [];
  const add = (raw: string): void => {
    const url = urlInput(raw);
    if (REMOTE.test(url) && !found.includes(url)) found.push(url);
  };
  const css = (m: RegExpMatchArray): string => decodeCssEscapes(m[1] ?? m[2] ?? m[3] ?? "");
  for (const block of text.matchAll(FONT_FACE)) for (const u of block[0].matchAll(FONT_URL)) add(css(u));
  for (const m of text.matchAll(IMPORT)) add(css(m));
  for (const href of linkHrefs(text)) add(decodeHtmlRefs(href));
  return found;
}

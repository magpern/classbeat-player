// The <meta> tags of an HTML page, read by tokenizing it rather than with a pattern (#378): an
// attribute may be quoted either way or not at all, in any letter case, and its value may be written
// with character references (`http-equiv="Content&#45;Security-Policy"`), none of which a text
// search sees. Comments, and the text of script, style, textarea and title, hold no tags. A
// character reference this reader cannot resolve is not guessed at: the tag is `unclear`, and the
// checks below treat an unclear http-equiv as a possible policy, so a page can only fail, never slip by.

export interface Meta {
  /** Attribute values, names in lower case, references decoded; the first of a repeated name wins. */
  readonly attrs: ReadonlyMap<string, string>;
  /** A value held a character reference this reader does not resolve. */
  readonly unclear: boolean;
}

const NAMED: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hyphen: "-", dash: "-", minus: "−", colon: ":", equals: "=", semi: ";", comma: ",", period: ".",
  sol: "/", bsol: "\\", lowbar: "_", num: "#", excl: "!", quest: "?", commat: "@", ast: "*", plus: "+", percnt: "%", dollar: "$", lpar: "(", rpar: ")",
  lsqb: "[", rsqb: "]", lbrace: "{", rbrace: "}", Tab: "\t", NewLine: "\n",
};

/** The value with its character references decoded; `unclear` when one is not understood. */
export function decode(raw: string): { text: string; unclear: boolean } {
  let unclear = false;
  const text = raw.replace(/&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(\w+));?/g, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    const code = hex !== undefined ? parseInt(hex, 16) : dec !== undefined ? parseInt(dec, 10) : null;
    if (code !== null) {
      if (code > 0x10ffff || Number.isNaN(code)) {
        unclear = true;
        return whole;
      }
      return String.fromCodePoint(code);
    }
    const named = name !== undefined ? NAMED[name] : undefined;
    if (named === undefined) unclear = true;
    return named ?? whole;
  });
  return { text, unclear };
}

const RAW_TEXT = /^(script|style|textarea|title)$/i;

/** Every start tag with its attributes, in order. */
function startTags(html: string): { name: string; meta: Meta }[] {
  const out: { name: string; meta: Meta }[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const nameMatch = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 200));
    if (!nameMatch) {
      // `</x>`, `<!doctype>`, `<?x>`, a stray `<`: skip to the next `>` (or past the `<`).
      const gt = /^<[/!?]/.test(html.slice(lt, lt + 2)) ? html.indexOf(">", lt) : -1;
      i = gt < 0 ? lt + 1 : gt + 1;
      continue;
    }
    const name = nameMatch[1].toLowerCase();
    let p = lt + nameMatch[0].length;
    const attrs = new Map<string, string>();
    let unclear = false;
    for (;;) {
      while (p < html.length && /[\s/]/.test(html[p])) p++;
      if (p >= html.length || html[p] === ">") break;
      const an = /^[^\s/>=]+/.exec(html.slice(p));
      if (!an) {
        p++;
        continue;
      }
      p += an[0].length;
      while (p < html.length && /\s/.test(html[p])) p++;
      let raw = "";
      if (html[p] === "=") {
        p++;
        while (p < html.length && /\s/.test(html[p])) p++;
        const q = html[p];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, p + 1);
          raw = html.slice(p + 1, end < 0 ? html.length : end);
          p = end < 0 ? html.length : end + 1;
        } else {
          const um = /^[^\s>]*/.exec(html.slice(p));
          raw = um ? um[0] : "";
          p += raw.length;
        }
      }
      const d = decode(raw);
      unclear = unclear || d.unclear;
      const key = an[0].toLowerCase();
      if (!attrs.has(key)) attrs.set(key, d.text);
    }
    out.push({ name, meta: { attrs, unclear } });
    i = p + 1;
    if (RAW_TEXT.test(name)) {
      const close = new RegExp(`</${name}[\\s/>]`, "i").exec(html.slice(i));
      i = close ? i + close.index : html.length;
    }
  }
  return out;
}

/** The <meta> tags of the page. */
export const metas = (html: string): Meta[] => startTags(html).filter((t) => t.name === "meta").map((t) => t.meta);

const isPolicy = (m: Meta): boolean => m.attrs.get("http-equiv")?.trim().toLowerCase() === "content-security-policy";
const maybePolicy = (m: Meta): boolean => isPolicy(m) || (m.unclear && m.attrs.has("http-equiv"));

/** The content security policies the page sets with a <meta>: the `content` of each. */
export const policyMetas = (html: string): string[] => metas(html).filter(isPolicy).map((m) => m.attrs.get("content") ?? "");

/** A <meta> that sets, or may set (an http-equiv this reader cannot fully read), a policy. */
export const hasPolicyMeta = (html: string): boolean => metas(html).some(maybePolicy);

/** How many <meta> tags set, or may set, a policy: a page that sets one has exactly one. */
export const policyMetaCount = (html: string): number => metas(html).filter(maybePolicy).length;

/** The `content` of the <meta name="referrer"> tags. */
export const referrerMetas = (html: string): string[] => metas(html).filter((m) => m.attrs.get("name")?.trim().toLowerCase() === "referrer").map((m) => m.attrs.get("content") ?? "");

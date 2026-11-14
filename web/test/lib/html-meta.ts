// The <meta> tags of an HTML page, read by tokenizing it rather than with a pattern (#378): an
// attribute may be quoted either way or not at all, in any letter case, and its value may be written
// with character references (`http-equiv="Content&#45;Security-Policy"`), none of which a text
// search sees. Comments end where the HTML standard says, and the text of script, style, textarea and title holds no tags. A
// character reference this reader cannot resolve is not guessed at: the tag is `unclear`, and the
// checks below treat an unclear http-equiv as a possible policy, so a page can only fail, never slip by. What the tokenizer skips is also searched with the old pattern.

export interface Meta {
  /** Attribute values, names in lower case, references decoded; the first of a repeated name wins. */
  readonly attrs: ReadonlyMap<string, string>;
  /** A value held a character reference this reader does not resolve. */
  readonly unclear: boolean;
  /** Where the tag is in the page: from its `<` to its end. */
  readonly at: number;
  readonly to: number;
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

/**
 * Every start tag with its attributes, in order, and whether the page held anything this reader
 * cannot read with certainty (`uncertain`): a browser reads an unclosed quote, tag, comment or
 * raw-text element to the end of the page and drops it, which a reader cannot be trusted to
 * mirror, so the checks below treat such a page as one that may hold a policy.
 */
function startTags(html: string): { tags: { name: string; meta: Meta }[]; uncertain: boolean } {
  const out: { name: string; meta: Meta }[] = [];
  let uncertain = false;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      // Where the HTML standard's tokenizer ends a comment: `<!-->` and `<!--->` at once (the
      // abrupt endings), otherwise at `-->` or `--!>` (the incorrectly closed ending).
      const end = html.startsWith(">", lt + 4) ? lt + 5 : html.startsWith("->", lt + 4) ? lt + 6 : (() => {
        const m = /--!?>/.exec(html.slice(lt + 4));
        if (!m) uncertain = true;
        return m ? lt + 4 + m.index + m[0].length : html.length;
      })();
      i = end;
      continue;
    }
    const nameMatch = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 200));
    if (!nameMatch) {
      // `</x>`, `<!doctype>`, `<?x>`, a stray `<`: skip to the next `>` (or past the `<`).
      const special = /^<[/!?]/.test(html.slice(lt, lt + 2));
      const gt = special ? html.indexOf(">", lt) : -1;
      if (special && gt < 0) uncertain = true;
      i = gt < 0 ? lt + 1 : gt + 1;
      continue;
    }
    const name = nameMatch[1].toLowerCase();
    let p = lt + nameMatch[0].length;
    const attrs = new Map<string, string>();
    let unclear = false;
    for (;;) {
      while (p < html.length && /[\s/]/.test(html[p])) p++;
      if (p >= html.length) {
        uncertain = true;
        break;
      }
      if (html[p] === ">") break;
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
          if (end >= 0) {
            raw = html.slice(p + 1, end);
            p = end + 1;
          } else {
            // An unclosed quote: a browser reads on to the end of the page and drops the tag and
            // everything after it. Not mirrored here: the page is uncertain.
            uncertain = true;
            raw = html.slice(p + 1);
            p = html.length;
          }
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
    out.push({ name, meta: { attrs, unclear, at: lt, to: p } });
    i = p + 1;
    if (RAW_TEXT.test(name)) {
      const close = new RegExp(`</${name}[\\s/>]`, "i").exec(html.slice(i));
      if (!close) uncertain = true;
      i = close ? i + close.index : html.length;
    }
  }
  // A character reference this reader cannot resolve, in any <meta>, is not guessed at either.
  return { tags: out, uncertain: uncertain || out.some((t) => t.name === "meta" && t.meta.unclear) };
}

/** The <meta> tags of the page. */
export const metas = (html: string): Meta[] =>
  startTags(html)
    .tags.filter((t) => t.name === "meta")
    .map((t) => t.meta);

/** The page holds something this reader cannot read with certainty: it may hold a policy. */
export const uncertain = (html: string): boolean => startTags(html).uncertain;

const equiv = (m: Meta): string => m.attrs.get("http-equiv")?.trim().toLowerCase() ?? "";
/** Sets the policy: exactly `Content-Security-Policy`. Where a policy must be present, only this counts. */
const isPolicy = (m: Meta): boolean => equiv(m) === "content-security-policy";
/**
 * Sets, or may set, a policy: a name that starts with `Content-Security-Policy` (so `-Report-Only` too,
 * as the old pattern's prefix match had it), or one this reader cannot fully read. Where a page must
 * have none, this is what counts.
 */
const maybePolicy = (m: Meta): boolean => equiv(m).startsWith("content-security-policy") || (m.unclear && m.attrs.has("http-equiv"));

/**
 * Text anywhere in the page, a comment, a script or a title included, that the old pattern took for
 * a policy and that is not inside a tag read above: counted as a policy too, so what the tokenizer
 * skips (as a browser does) can still only make a check fail, never pass.
 */
function hiddenPolicies(html: string): number {
  const spans = metas(html).filter(maybePolicy);
  let n = 0;
  for (const m of html.matchAll(/http-equiv\s*=\s*["']?content-security-policy/gi)) {
    if (!spans.some((t) => m.index >= t.at && m.index < t.to)) n++;
  }
  return n;
}

/** The content security policies the page sets with a <meta>: the `content` of each. */
export const policyMetas = (html: string): string[] => metas(html).filter(isPolicy).map((m) => m.attrs.get("content") ?? "");

/** A <meta> that sets, or may set (an http-equiv this reader cannot fully read, or one in text it skips), a policy. */
export const hasPolicyMeta = (html: string): boolean => metas(html).some(maybePolicy) || hiddenPolicies(html) > 0 || uncertain(html);

/** How many <meta> tags set, or may set, a policy (an uncertain page counts one more): a page that sets one has exactly one. */
export const policyMetaCount = (html: string): number => metas(html).filter(maybePolicy).length + hiddenPolicies(html) + (uncertain(html) ? 1 : 0);

/**
 * The content of the page's one policy meta, where a page must have exactly one: null when there is
 * none, more than one, or one that is not exactly `Content-Security-Policy` or not plainly readable
 * (a `-Report-Only` meta enforces nothing).
 */
export function onlyPolicy(html: string): string | null {
  if (uncertain(html)) return null;
  const found = policyMetas(html);
  return found.length === 1 && policyMetaCount(html) === 1 ? found[0] : null;
}

/** The `content` of the <meta name="referrer"> tags. */
export const referrerMetas = (html: string): string[] => metas(html).filter((m) => m.attrs.get("name")?.trim().toLowerCase() === "referrer").map((m) => m.attrs.get("content") ?? "");

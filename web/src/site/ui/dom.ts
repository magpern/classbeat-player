// DOM helpers for the site. Text is only ever set with textContent: nothing an answer holds
// becomes markup. Every piece of text is a leaf span marked for the spec's checks (site.md,
// S1, S2 and S6): its type tier, the smallest cap height it may have in pixels and how many
// lines it may take.

/** Kind of text: [tier, minimum cap height in px] (site.md, S1). */
export const KIND = {
  brand: ["minor", 17],
  h1: ["minor", 21],
  h2: ["minor", 17],
  body: ["minor", 12],
  title: ["minor", 13],
  small: ["minor", 10],
  label: ["label", 9],
  btn: ["minor", 12],
  flab: ["minor", 10],
  len: ["minor", 17],
} as const;
export type Kind = keyof typeof KIND;

export interface Attrs {
  readonly class?: string;
  readonly id?: string;
  readonly role?: string;
  readonly [attr: `aria-${string}`]: string | undefined;
}

export type Child = Node | string | null | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

/** A text leaf of one kind; it may take up to `lines` lines before the checks call it a problem. */
export function t(kind: Kind, text: string, lines = 6): HTMLSpanElement {
  const [tier, min] = KIND[kind];
  const s = document.createElement("span");
  s.dataset.tier = tier;
  s.dataset.minCap = String(min);
  s.dataset.lines = String(lines);
  s.textContent = text;
  return s;
}

let ids = 0;
/** A fresh id for label and description links. */
export const uid = (stem: string): string => `${stem}-${(ids += 1)}`;

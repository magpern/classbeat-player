// The browser is the authority on which <meta> policies a page has (#378): this reads them from the
// DOM of a page loaded in Chromium, where the static reader (html-meta.ts) can only mirror the
// parser. `httpEquiv` is compared case-insensitively, and a name that starts with
// `content-security-policy` (Report-Only too) is counted as a policy for the "has none" checks.
import type { Page } from "playwright-core";

export interface DomMeta {
  readonly equiv: string;
  readonly content: string;
}

/** Every <meta http-equiv> of the page's own DOM, the name in lower case. */
export async function domMetas(page: Page): Promise<DomMeta[]> {
  // A source string, so a transpiler's helper is not serialised into the page.
  return page.evaluate(`[...document.querySelectorAll("meta[http-equiv]")].map((m) => ({ equiv: (m.httpEquiv || m.getAttribute("http-equiv") || "").trim().toLowerCase(), content: m.getAttribute("content") ?? "" }))`) as Promise<DomMeta[]>;
}

/** The <meta> policies of the page, enforcing or not: a name that starts with `content-security-policy`. */
export const domPolicies = (metas: readonly DomMeta[]): DomMeta[] => metas.filter((m) => m.equiv.startsWith("content-security-policy"));

/** The one enforcing policy a page must have: null unless there is exactly one policy meta and it is exact. */
export function domOnlyPolicy(metas: readonly DomMeta[]): string | null {
  const all = domPolicies(metas);
  return all.length === 1 && all[0].equiv === "content-security-policy" ? all[0].content : null;
}

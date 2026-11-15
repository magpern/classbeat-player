// The top-level navigations away from the site that a state may make (#422 N3; #508 B1): exactly
// the one address the state declares, or none. The fake (site-fake.ts) cancels each and records it
// in `left` (the linked app's site) or `toClassbeat` (classbeat), so the per-state guards
// (site-page-security.test.ts, site-measure.ts) compare both lists with what the state names.

export interface Declared {
  readonly leaves?: string;
  readonly toClassbeat?: string;
}

export interface Navigated {
  readonly left: readonly string[];
  readonly toClassbeat: readonly string[];
}

const expected = (declared: string | undefined): string[] => (declared === undefined ? [] : [declared]);
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((u, i) => u === b[i]);

/** One line per list that differs from what the state declares; empty when both match. */
export function navigationProblems(state: Declared, site: Navigated): string[] {
  const out: string[] = [];
  const leaves = expected(state.leaves);
  if (!same(site.left, leaves)) out.push(`navigations to the linked app's site ${JSON.stringify(site.left)}, not ${JSON.stringify(leaves)}`);
  const classbeat = expected(state.toClassbeat);
  if (!same(site.toClassbeat, classbeat)) out.push(`navigations to classbeat ${JSON.stringify(site.toClassbeat)}, not ${JSON.stringify(classbeat)}`);
  return out;
}

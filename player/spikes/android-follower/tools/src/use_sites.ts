// Use-site pins for the names the reflection guard relies on (review of #568, round 4). Pure.
// Intent, ComponentName and getSystemService are allowed only in the exact statements pinned for the file
// (use_site_pins.ts). So no declaration, receiver, alias, cast or type position needs recognising: any
// statement that names one and is not pinned fails, whatever Kotlin syntax it uses.

import { USE_SITE_PINS } from "./use_site_pins.js";

const NAMES = /\b(?:Intent|ComponentName|getSystemService)\b/;
/** A line that cannot start a new statement: it begins with an operator or a closing bracket. */
const STARTS_CONTINUED = /^(?:[.)\]}]|\?[.:]|&&|\|\||[-+*/%=]|(?:as|is|in|else)\b)/;
/** A line that cannot end a statement: it ends with an operator or an opening bracket. */
const ENDS_OPEN = /(?:[(\[,.=+\-*/%&|:?<]|->)$/;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The statements of `text`, whitespace collapsed: a line, joined to the next while it is clearly unfinished. */
export function statements(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const continues = cur !== "" && (depth > 0 || ENDS_OPEN.test(cur) || STARTS_CONTINUED.test(line));
    if (!continues && cur !== "") { out.push(collapse(cur)); cur = ""; depth = 0; }
    cur = cur === "" ? line : `${cur} ${line}`;
    for (const c of line) depth += c === "(" || c === "[" ? 1 : c === ")" || c === "]" ? -1 : 0;
    depth = Math.max(0, depth);
  }
  if (cur !== "") out.push(collapse(cur));
  return out;
}

/** The statements of `text` that name one of the three, and are not pinned for `path`. */
export function unpinnedUseSites(path: string, text: string): string[] {
  const pinned = new Set(USE_SITE_PINS[path] ?? []);
  return statements(text).filter((s) => NAMES.test(s) && !pinned.has(s));
}

/** The first unpinned statement in any of the views, as a message, or null. */
export function useSiteProblem(path: string, views: string[]): string | null {
  for (const v of views) {
    const bad = unpinnedUseSites(path, v)[0];
    if (bad) return `\`${bad}\` names Intent, ComponentName or getSystemService outside the pinned use sites: change the pin in tools/src/use_site_pins.ts in the same pull request`;
  }
  return null;
}

// What the rule guards read: the phone shell's sources, and each file as its checks see it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { REPO } from "./fixtures.ts";
import { kotlinSource } from "./kotlin-lex.ts";
import { cssSource, jsSource, markupSource } from "./ts-lex.ts";

/**
 * Comments out (`//`, `/* … *\/`, `<!-- … -->`), for TypeScript, HTML and XML. It knows nothing of
 * strings: a "//" in a string cuts the rest of its line, so it is never a Kotlin check's only view.
 */
export const code = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

/** The texts a Kotlin check reads. A check hits when it hits in any of them. */
export type Views = (text: string) => string[];
/**
 * Every Kotlin check reads two views: `kotlinSource`, the code and the strings' contents with only
 * the real comments out, so no comment marker in a string hides code; and `code`, the view the
 * checks read before (issue #859), kept so that no check sees less than it did.
 */
export const ktViews: Views = (text) => [code(text), kotlinSource(text)];
/** `code` alone: what a check saw before #859. The mutation tables use it to show a "//" hid code from it. */
export const naiveView: Views = (text) => [code(text)];

/**
 * The views of a TypeScript, CSS or markup check (issue #861): the text the check read before, by
 * `old`, and the file with only its real comments out (ts-lex.ts), so no comment marker in a string
 * hides code and no check sees less than it did. The lexer is picked by the file's extension.
 */
export const sourceOf = (path: string): ((text: string) => string) =>
  /\.(html|xml)$/.test(path) ? markupSource : /\.css$/.test(path) ? cssSource : jsSource;
export const withSource =
  (old: (text: string) => string, path = "x.ts"): Views =>
  (text) => [old(text), sourceOf(path)(text)];
/** What most TypeScript checks read before #861: `code` without its HTML step. */
export const slashCode = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
/** What a few read: every "//" to the end of its line out, block comments kept. */
export const lineCode = (t: string): string => t.replace(/\/\/.*$/gm, "");
/** The view a check read before #861, alone: the mutation tables show a "//" hid code from it. */
export const oldView = (old: (text: string) => string): Views => (text) => [old(text)];

/**
 * `re`, refused when it is global or sticky: `test` on such a regex starts at the `lastIndex` the
 * last call left, so a hit in one view or file could hide a hit in the next (issue #870).
 */
export function fresh(re: RegExp): RegExp {
  if (re.global || re.sticky) throw new Error(`${re}: a check's regex must not be global or sticky`);
  return re;
}
/** A check that hits when `re` (neither global nor sticky) matches any view of the file. */
export const forbids = (re: RegExp, old: (text: string) => string = code): Check => {
  fresh(re);
  return (path, text, views = withSource(old, path)) => views(text).some((v) => re.test(v));
};
/** A check that hits when what `extract` finds in any view of the file is not `expected`. */
export const differs =
  <T>(extract: (view: string) => T, expected: T, old: (text: string) => string = code): Check =>
  (path, text, views = withSource(old, path)) =>
    views(text).some((v) => !isDeepStrictEqual(extract(v), expected));

/** A source of the desktop app by its path under player/app/src ("/" or the system's separator). */
export const APP_SRC = join(REPO, "player", "app", "src");
export const appText = (path: string): string => readFileSync(join(APP_SRC, ...path.split(/[\\/]/)), "utf8");

// The phone shell (player/mobile, issue #627). Installed packages, build output and the bundled
// page (built from the sources checked here) are not sources. They are skipped by their exact
// paths, so a source folder that happens to be called "build" or "public" elsewhere is still checked.
export const MOBILE = join(REPO, "player", "mobile");
export const MOBILE_SKIP = new Set(
  ["node_modules", "android/.gradle", "android/.kotlin", "android/build", "android/app/build", "android/app/src/main/assets/public"].map((p) => join(...p.split("/"))),
);
export function mobileFiles(dir: string, ext: RegExp, root = MOBILE): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return MOBILE_SKIP.has(relative(root, p)) ? [] : mobileFiles(p, ext, root);
    return ext.test(n) ? [p] : [];
  });
}
const mobileSource = (ext: RegExp) => mobileFiles(MOBILE, ext).map((p) => ({ path: relative(MOBILE, p), text: readFileSync(p, "utf8") }));
export const mobileTs = mobileSource(/\.(ts|mjs|js|html)$/);
export const mobileKt = mobileSource(/\.(kt|kts|java)$/);

/** A Kotlin source by its path under player/mobile; the test fails if it is gone. */
export function ktFile(path: string): { path: string; text: string } {
  const file = mobileKt.find((s) => s.path === path);
  if (!file) throw new Error(`${path} is not a Kotlin source`);
  return file;
}

export const KT_BACKEND = ["android", "app", "src", "main", "kotlin", "org", "classbeat", "player", "backend"];
export const KT_FOLLOW = [...KT_BACKEND.slice(0, -1), "follow"];
export const BACKEND_TRANSPORT = join(...KT_BACKEND, "BackendTransport.kt");
export const SESSION_READER = join(...KT_FOLLOW, "SpotifySessionReader.kt");
export const MAIN_ACTIVITY = join(...KT_BACKEND.slice(0, -1), "MainActivity.kt");

/**
 * A mutation of a real source file that a check must catch: the check, the file, the text replaced
 * and its replacement, and whether the old view alone misses it (the "//" in a string hides it).
 */
export type Mutation = [check: string, path: string, from: string, to: string, hiddenFromCode: boolean];
export type KtMutation = Mutation;
/** A check on one file: whether it is a hit (a broken rule) in any of the views. */
export type Check = (path: string, text: string, views?: Views) => boolean;

/**
 * Applies each mutation to its file and returns what went wrong, one line each; empty when all hold.
 * `read` gives a file's text by its path (a Kotlin source by default); `naive` is the view the
 * checks read before (`code` by default).
 */
export function mutationGaps(
  mutations: readonly Mutation[],
  checks: ReadonlyMap<string, Check>,
  read: (path: string) => string = (p) => ktFile(p).text,
  naive: Views = naiveView,
): string[] {
  const gaps: string[] = [];
  for (const [check, path, from, to, hidden] of mutations) {
    const hit = checks.get(check);
    const text = read(path);
    const mutated = text.replace(from, to);
    const name = `${check}: ${to}`;
    if (!hit) gaps.push(`${name}: no such check`);
    else if (mutated === text) gaps.push(`${name}: the file does not hold ${from}`);
    else if (hit(path, text)) gaps.push(`${name}: the file fails before the mutation`);
    else if (!hit(path, mutated)) gaps.push(`${name}: not caught`);
    else if (hidden && hit(path, mutated, naive)) gaps.push(`${name}: the old view alone catches it, so it tests no "//"`);
    else if (!hidden && !hit(path, mutated, naive)) gaps.push(`${name}: the old view alone misses it; mark it hidden`);
  }
  return gaps;
}

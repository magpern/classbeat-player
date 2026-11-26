// What the rule guards read: the phone shell's sources, and each file as its checks see it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO } from "./fixtures.ts";
import { kotlinSource } from "./kotlin-lex.ts";

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
 * A mutation of a real Kotlin file that a check must catch: the check, the file, the text replaced
 * and its replacement, and whether `code` alone misses it (the "//" in a string hides it).
 */
export type KtMutation = [check: string, path: string, from: string, to: string, hiddenFromCode: boolean];

/** Applies each mutation to its file and returns what went wrong, one line each; empty when all hold. */
export function mutationGaps(mutations: readonly KtMutation[], checks: ReadonlyMap<string, (path: string, text: string, views?: Views) => boolean>): string[] {
  const gaps: string[] = [];
  for (const [check, path, from, to, hidden] of mutations) {
    const hit = checks.get(check);
    const text = ktFile(path).text;
    const mutated = text.replace(from, to);
    const name = `${check}: ${to}`;
    if (!hit) gaps.push(`${name}: no such check`);
    else if (mutated === text) gaps.push(`${name}: the file does not hold ${from}`);
    else if (hit(path, text)) gaps.push(`${name}: the file fails before the mutation`);
    else if (!hit(path, mutated)) gaps.push(`${name}: not caught`);
    else if (hidden && hit(path, mutated, naiveView)) gaps.push(`${name}: code() alone catches it, so it tests no "//"`);
    else if (!hidden && !hit(path, mutated, naiveView)) gaps.push(`${name}: code() alone misses it; mark it hidden`);
  }
  return gaps;
}

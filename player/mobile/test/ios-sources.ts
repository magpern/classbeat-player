// The iOS app's sources as the rule guards read them (issue #894): every Swift and Objective-C
// file under player/mobile/ios, with the pods, the build output and the bundled page skipped by
// their exact paths (MOBILE_SKIP).
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { code, fresh, MOBILE, mobileFiles, type Check, type Views } from "../../app/test/unit/rule-sources.ts";
import { swiftSource } from "./swift-lex.ts";

export const IOS = join(MOBILE, "ios");
const read = (ext: RegExp) => mobileFiles(IOS, ext).map((p) => ({ path: relative(MOBILE, p), text: readFileSync(p, "utf8") }));
export const swiftFiles = read(/\.swift$/);
/** Objective-C, C, C++ and assembly sources and headers: everything a target compiles besides Swift. */
export const NATIVE_SOURCE = /\.(m|mm|h|hh|hxx|hpp|c|cc|cpp|cxx|inc|s|S)$/;
export const objcFiles = read(NATIVE_SOURCE);
export const isSwift = (path: string): boolean => path.endsWith(".swift");

/**
 * A Swift check reads `code` and `swiftSource` (comments out, strings whole), so no "//" in a
 * string hides the code after it. An Objective-C check reads `code` and the whole text: there is
 * no Objective-C in the app, so a banned name even in a comment is a hit.
 */
export const iosViews = (path: string): Views => (isSwift(path) ? (t) => [code(t), swiftSource(t)] : (t) => [code(t), t]);

/** A check that hits when `re` (neither global nor sticky) matches any view of the file. */
export const bans = (re: RegExp): Check => {
  fresh(re);
  return (path, text, views = iosViews(path)) => views(text).some((v) => re.test(v));
};

/** A check that hits when `bad` returns true for any view of the file. */
export const hitsWhen =
  (bad: (path: string, view: string) => boolean): Check =>
  (path, text, views = iosViews(path)) =>
    views(text).some((v) => bad(path, v));

/** A source by its path under player/mobile; planted files are in `planted`. */
export function iosText(path: string, planted: Readonly<Record<string, string>> = {}): string {
  const p = planted[path];
  if (p !== undefined) return p;
  const file = [...swiftFiles, ...objcFiles].find((s) => s.path === path);
  if (!file) throw new Error(`${path} is not an iOS source`);
  return file.text;
}

// The backend's rules for the rider page's headers (backend/src/player_backend/rider_page_policy.py),
// read from that file's text, and the check that the rider fake (rider-fake.ts) serves exactly them.
// Two parts are read: every string literal that is a value (the paths, the policy's pieces, each
// header's key and value), and the code around them as a skeleton, with every string literal
// emptied and the docstrings and comments taken out. The skeleton is pinned here, so any change to
// the backend's logic (another header, another connect source, another cache rule) fails this check
// until the fake follows it; any change to a value fails the comparison with the fake.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_DIR } from "./browser.ts";
import { ASSET_RULE, isAssetPathBy } from "./control-rule.ts";

export const RIDER_POLICY_SOURCE = join(WEB_DIR, "..", "backend", "src", "player_backend", "rider_page_policy.py");

/** The backend file's code without docstrings and comments; the same skeleton is pinned below. */
const TOKENS = /"""[^]*?"""|f?"(?:[^"\\\n]|\\.)*"|#[^\n]*/g;
export function codeOf(source: string): string {
  return source.replace(TOKENS, (t) => (t.startsWith('"""') || t.startsWith("#") ? "" : t));
}
export function skeletonOf(source: string): string {
  return codeOf(source).replace(TOKENS, (t) => (t.startsWith("f") ? 'f""' : '""')).replace(/\s+/g, " ").trim();
}

/** rider_page_policy.py with every string emptied, docstrings and comments gone, whitespace collapsed. */
export const SKELETON =
  'from __future__ import annotations from typing import Final from player_backend.control_page_policy import asset_type RIDER_PATH: Final = "" _FETCHED: Final = ("",) _LIVE_WS: Final = "" def is_rider_path(path: str) -> bool: return path == RIDER_PATH or path.startswith(RIDER_PATH + "") def content_security_policy(site_origin: str) -> str: socket_origin = "" + site_origin.removeprefix("") connect = "".join([*(site_origin + p for p in _FETCHED), socket_origin + _LIVE_WS]) return ( "" f"" "" ) def is_asset_path(path: str) -> bool: relative = path.removeprefix(RIDER_PATH + "") return is_rider_path(path) and relative != path and asset_type(relative) is not None def rider_headers(path: str, site_origin: str) -> dict[str, str]: return { "": content_security_policy(site_origin), "": "", "": "", "": "", "": "" if is_asset_path(path) else "", }';

const strings = (text: string): string[] => [...text.matchAll(/f?"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

function found(re: RegExp, text: string, what: string): RegExpExecArray {
  const m = re.exec(text);
  if (!m) throw new Error(`the backend's ${what} was not found`);
  return m;
}

function bodyOf(code: string, name: string): string {
  const start = code.indexOf(`def ${name}(`);
  if (start < 0) throw new Error(`the backend's ${name} was not found`);
  const end = code.indexOf("\ndef ", start + 1);
  return code.slice(start, end < 0 ? undefined : end);
}

export interface RiderRule {
  readonly csp: (siteOrigin: string) => string;
  readonly headers: (path: string, siteOrigin: string) => Record<string, string>;
}

/** The backend's rule, read from its file; throws when a part is not where this reader expects it. */
export function parseRiderRule(source: string): RiderRule {
  const code = codeOf(source);
  if (skeletonOf(source) !== SKELETON) throw new Error("the backend's rider_page_policy.py changed shape: update the rider fake, then SKELETON");
  const path = found(/^RIDER_PATH: Final = "([^"]*)"$/m, code, "RIDER_PATH")[1];
  const fetched = strings(found(/^_FETCHED: Final = \(([^)]*)\)$/m, code, "_FETCHED")[1]);
  const ws = found(/^_LIVE_WS: Final = "([^"]*)"$/m, code, "_LIVE_WS")[1];
  const csp = bodyOf(code, "content_security_policy");
  const [, scheme, strip] = found(/socket_origin = "([^"]*)" \+ site_origin\.removeprefix\("([^"]*)"\)/, csp, "socket origin");
  const sep = found(/connect = "([^"]*)"\.join\(/, csp, "connect separator")[1];
  const pieces = strings(found(/return \(([^]*?)\n {4}\)/, csp, "policy")[1]).join("");
  const slash = [...strings(bodyOf(code, "is_rider_path")), ...strings(bodyOf(code, "is_asset_path"))];
  if (slash.length !== 2 || slash.some((s) => s !== "/")) throw new Error("the backend's path rule changed: update the rider fake");
  const ret = found(/return \{([^]*?)\n {4}\}/, bodyOf(code, "rider_headers"), "headers")[1];
  const pairs = [...(ret + "\n").matchAll(/"([^"]*)": ([^\n]+?),?\n/g)].map((m) => [m[1], m[2]] as const);
  const fixed = Object.fromEntries(pairs.filter(([, v]) => /^"[^"]*"$/.test(v)).map(([k, v]) => [k, v.slice(1, -1)]));
  const cspKey = found(/"([^"]*)": content_security_policy\(site_origin\)/, ret, "policy header")[1];
  const [, cacheKey, asset, page] = found(/"([^"]*)": "([^"]*)" if is_asset_path\(path\) else "([^"]*)"/, ret, "cache rule");
  const policy = (o: string): string => {
    const socket = scheme + (o.startsWith(strip) ? o.slice(strip.length) : o);
    return pieces.replace("{connect}", [...fetched.map((p) => o + p), socket + ws].join(sep));
  };
  return {
    csp: policy,
    headers: (p, o) => ({ [cspKey]: policy(o), ...fixed, [cacheKey]: isAssetPathBy(ASSET_RULE, p, path) ? asset : page }),
  };
}

/** Paths under /j and around it, both kinds of Cache-Control among them. */
export const PATHS = ["/j", "/j/", "/j/index.html", "/j/rider.js", "/j/rider.css", "/j/fonts/ui.woff2", "/j/rider.js.map", "/j/a/b/c.js", "/j/Upper.js", "/j/nothing", "/jx/a.js", "/control/companion.js"];
export const ORIGINS = ["https://site.example", "https://site.test", "https://site.test:8443"];

/** Throws unless the fake serves, for every origin and path, exactly what the backend's rule gives. */
export function checkFake(source: string, fake: RiderRule): void {
  const rule = parseRiderRule(source);
  for (const o of ORIGINS) {
    if (fake.csp(o) !== rule.csp(o)) throw new Error(`policy for ${o}: fake ${fake.csp(o)}\nbackend ${rule.csp(o)}`);
    for (const p of PATHS) {
      const a = JSON.stringify(Object.entries(fake.headers(p, o)).sort());
      const b = JSON.stringify(Object.entries(rule.headers(p, o)).sort());
      if (a !== b) throw new Error(`headers of ${p} for ${o}: fake ${a}\nbackend ${b}`);
    }
  }
}

export const RIDER_SOURCE = (): string => readFileSync(RIDER_POLICY_SOURCE, "utf8");

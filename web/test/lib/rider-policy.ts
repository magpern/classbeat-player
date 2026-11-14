// The backend's rules for the rider page's headers (backend/src/player_backend/rider_page_policy.py,
// and the part it shares with the companion page in control_page_policy.py), read from those files'
// text, and the check that the rider fake (rider-fake.ts) serves exactly them. The source read is the
// rider file followed by the shared part of the control file: its `_LIVE_WS` line and the functions
// the rider's headers come from (SHARED), each as written there. Two parts are read: every string
// literal that is a value (the paths, the policy's pieces, each header's key and value), and the code
// around them as a skeleton, with every string literal emptied and the docstrings and comments taken
// out. The skeleton is pinned here, so any change to the backend's logic (another header, another
// connect source, another cache rule) fails this check until the fake follows it; any change to a
// value fails the comparison with the fake.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_DIR } from "./browser.ts";
import { ASSET_RULE, POLICY_SOURCE, isAssetPathBy } from "./control-rule.ts";

export const RIDER_POLICY_SOURCE = join(WEB_DIR, "..", "backend", "src", "player_backend", "rider_page_policy.py");

/** The backend file's code without docstrings and comments; the same skeleton is pinned below. */
const TOKENS = /"""[^]*?"""|f?"(?:[^"\\\n]|\\.)*"|#[^\n]*/g;
export function codeOf(source: string): string {
  return source.replace(TOKENS, (t) => (t.startsWith('"""') || t.startsWith("#") ? "" : t));
}
export function skeletonOf(source: string): string {
  return codeOf(source).replace(TOKENS, (t) => (t.startsWith("f") ? 'f""' : '""')).replace(/\s+/g, " ").trim();
}

/** The functions of control_page_policy.py the rider's headers come from, in the order they are read. */
export const SHARED = ["is_page_path", "page_policy", "is_asset_path", "page_headers"] as const;

/** The control file's `_LIVE_WS` line and each SHARED function, as written there (docstrings and all). */
export function sharedOf(control: string): string {
  const parts = [found(/^_LIVE_WS: Final = .*$/m, control, "_LIVE_WS")[0]];
  for (const name of ["_LIVE_WS", ...SHARED]) {
    // Bound once at the top level: a second definition or assignment would go unread.
    const bound = control.match(new RegExp(`^(?:(?:async )?def ${name}\\b|${name}\\s*[:=])`, "gm")) ?? [];
    if (bound.length !== 1) throw new Error(`the backend's ${name} is bound ${bound.length} times in control_page_policy.py`);
  }
  for (const name of SHARED) {
    const start = control.search(new RegExp(`^def ${name}\\(`, "m"));
    if (start < 0) throw new Error(`the backend's ${name} was not found`);
    // To the next line that starts at the margin, but for the `)` that closes a wrapped signature.
    const end = control.slice(start).search(/\n(?=[^\s)])/);
    parts.push(control.slice(start, end < 0 ? undefined : start + end));
  }
  return parts.join("\n\n\n");
}

/** rider_page_policy.py, then sharedOf(control_page_policy.py), with every string emptied, docstrings and comments gone, whitespace collapsed. */
export const SKELETON =
  'from __future__ import annotations from typing import Final from player_backend.control_page_policy import is_page_path, page_headers, page_policy RIDER_PATH: Final = "" _FETCHED: Final = ("",) def is_rider_path(path: str) -> bool: return is_page_path(path, RIDER_PATH) def content_security_policy(site_origin: str) -> str: return page_policy(site_origin, _FETCHED) def rider_headers(path: str, site_origin: str) -> dict[str, str]: return page_headers(path, site_origin, RIDER_PATH, _FETCHED) _LIVE_WS: Final = "" def is_page_path(path: str, base: str) -> bool: return path == base or path.startswith(base + "") def page_policy(site_origin: str, routes: tuple[str, ...]) -> str: socket_origin = "" + site_origin.removeprefix("") connect = "".join([*(site_origin + p for p in routes), socket_origin + _LIVE_WS]) return ( "" f"" "" ) def is_asset_path(path: str, base: str) -> bool: relative = path.removeprefix(base + "") return is_page_path(path, base) and relative != path and asset_type(relative) is not None def page_headers(path: str, site_origin: str, base: str, routes: tuple[str, ...]) -> dict[str, str]: return { "": page_policy(site_origin, routes), "": "", "": "", "": "", "": "" if is_asset_path(path, base) else "", }';

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

/** The backend's rule, read from RIDER_SOURCE's text; throws when a part is not where this reader expects it. */
export function parseRiderRule(source: string): RiderRule {
  const code = codeOf(source);
  if (skeletonOf(source) !== SKELETON) throw new Error("the backend's rider_page_policy.py or its shared part changed shape: update the rider fake, then SKELETON");
  const path = found(/^RIDER_PATH: Final = "([^"]*)"$/m, code, "RIDER_PATH")[1];
  const fetched = strings(found(/^_FETCHED: Final = \(([^)]*)\)$/m, code, "_FETCHED")[1]);
  const ws = found(/^_LIVE_WS: Final = "([^"]*)"$/m, code, "_LIVE_WS")[1];
  const csp = bodyOf(code, "page_policy");
  const [, scheme, strip] = found(/socket_origin = "([^"]*)" \+ site_origin\.removeprefix\("([^"]*)"\)/, csp, "socket origin");
  const sep = found(/connect = "([^"]*)"\.join\(/, csp, "connect separator")[1];
  const pieces = strings(found(/return \(([^]*?)\n {4}\)/, csp, "policy")[1]).join("");
  const slash = [...strings(bodyOf(code, "is_page_path")), ...strings(bodyOf(code, "is_asset_path"))];
  if (slash.length !== 2 || slash.some((s) => s !== "/")) throw new Error("the backend's path rule changed: update the rider fake");
  const ret = found(/return \{([^]*?)\n {4}\}/, bodyOf(code, "page_headers"), "headers")[1];
  const pairs = [...(ret + "\n").matchAll(/"([^"]*)": ([^\n]+?),?\n/g)].map((m) => [m[1], m[2]] as const);
  const fixed = Object.fromEntries(pairs.filter(([, v]) => /^"[^"]*"$/.test(v)).map(([k, v]) => [k, v.slice(1, -1)]));
  const cspKey = found(/"([^"]*)": page_policy\(site_origin, routes\)/, ret, "policy header")[1];
  const [, cacheKey, asset, page] = found(/"([^"]*)": "([^"]*)" if is_asset_path\(path, base\) else "([^"]*)"/, ret, "cache rule");
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

/** rider_page_policy.py followed by the shared part of control_page_policy.py (sharedOf). */
export const RIDER_SOURCE = (): string => readFileSync(RIDER_POLICY_SOURCE, "utf8") + "\n\n" + sharedOf(readFileSync(POLICY_SOURCE, "utf8"));

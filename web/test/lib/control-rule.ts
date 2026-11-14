// The backend's rule for which built files under /control are scripts, styles and fonts
// (backend/src/player_backend/control_page_policy.py: ASSET_TYPES, _SEGMENT, MAX_DEPTH), read from
// that file's text so the companion fake has one source for it and cannot drift from it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_DIR } from "./browser.ts";

export const POLICY_SOURCE = join(WEB_DIR, "..", "backend", "src", "player_backend", "control_page_policy.py");

export interface AssetRule {
  readonly segment: RegExp;
  readonly maxDepth: number;
  readonly extensions: readonly string[];
}

/** Reads the asset rule out of the backend file's text; throws when a part is not found. */
export function parseAssetRule(source: string): AssetRule {
  const types = /^ASSET_TYPES: Final = \{([^}]*)\}/m.exec(source);
  // Count every key (either quote style), so one the pattern below cannot read fails loudly.
  const keys = types ? [...types[1].matchAll(/^\s*\S+\s*:/gm)].length : 0;
  const segment = /^_SEGMENT: Final = re\.compile\(r"([^"]+)"\)/m.exec(source);
  const depth = /^MAX_DEPTH: Final = (\d+)$/m.exec(source);
  if (!types || !segment || !depth) throw new Error("the backend's asset rule was not found");
  const extensions = [...types[1].matchAll(/["'](\.[^"']+)["']\s*:/g)].map((m) => m[1]);
  if (extensions.length === 0 || extensions.length !== keys) throw new Error("the backend's asset types were not found");
  return { segment: new RegExp(`^(?:${segment[1]})$`), maxDepth: Number(depth[1]), extensions };
}

/**
 * Whether a path under /control names a script, a style sheet or a font. Mirrors the backend's
 * `is_asset_path` and `asset_type` (control_page_policy.py); only the constants are read from it,
 * so companion-fake-headers.test.ts checks this logic against a table of paths.
 */
export function isAssetPathBy(rule: AssetRule, path: string): boolean {
  const rel = path.replace(/^\/control\//, "");
  if (rel === path) return false;
  const segments = rel.split("/");
  if (segments.length > rule.maxDepth || !segments.every((s) => rule.segment.test(s))) return false;
  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf(".");
  return dot > 0 && rule.extensions.includes(name.slice(dot));
}

export const ASSET_RULE: AssetRule = parseAssetRule(readFileSync(POLICY_SOURCE, "utf8"));

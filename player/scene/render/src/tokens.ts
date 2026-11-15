// The scene's design tokens, read from the screens lane's tokens.css (scene.md "Tokens"): the zone
// colours and the white are never kept in a table of the scene's own. The scene-only tokens that
// tokens.css does not hold yet fall back to the spec's values and are named in `missing`, so the
// screens lane's follow-up is visible. Pure: it reads through an accessor, never the DOM.

import type { ZoneNumber } from "../../model/src/index.ts";
import { ZONES } from "../../model/src/index.ts";

export interface StyleSource {
  getPropertyValue(name: string): string;
}

export interface SceneTokens {
  /** `--zone-1` to `--zone-7`, as 0xRRGGBB. */
  readonly zones: Readonly<Record<ZoneNumber, number>>;
  /** `--light-1`: the white of the rig (bursts, the finished house). */
  readonly white: number;
  /** `--scene-down`: lights down (paused), a share of full. */
  readonly down: number;
  /** `--scene-burst`: the drop burst's peak share of white. */
  readonly burstPeak: number;
  /** `--scene-burst`: the burst's decay, ms. */
  readonly burstMs: number;
  /** `--scene-text-cap`: the highest relative luminance of the scene under text (S2). */
  readonly textCap: number;
  /** Scene tokens that were not in tokens.css, so the spec's value was used. */
  readonly missing: readonly string[];
}

/** The spec's values for the scene-only tokens (scene.md "Tokens"), used only while tokens.css lacks them. */
export const SCENE_TOKEN_DEFAULTS = { down: 0.06, burstPeak: 0.85, burstMs: 250, textCap: 0.08 } as const;

export function parseHex(value: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

export function readSceneTokens(style: StyleSource): SceneTokens {
  const colour = (name: string): number => {
    const v = parseHex(style.getPropertyValue(name));
    if (v === null) throw new Error(`tokens.css must be loaded: ${name} is not a #rrggbb colour`);
    return v;
  };
  const zones = Object.fromEntries(ZONES.map((z) => [z, colour(`--zone-${z}`)])) as Record<ZoneNumber, number>;
  const missing: string[] = [];
  const number = (name: string, fallback: number): number => {
    const m = /^\s*(\d*\.?\d+)/.exec(style.getPropertyValue(name));
    if (m) return Number(m[1]);
    if (!missing.includes(name)) missing.push(name);
    return fallback;
  };
  const burstRaw = style.getPropertyValue("--scene-burst");
  const burstMs = /(\d+)\s*ms/.exec(burstRaw);
  const burstPeak = number("--scene-burst", SCENE_TOKEN_DEFAULTS.burstPeak);
  return {
    zones, white: colour("--light-1"),
    down: number("--scene-down", SCENE_TOKEN_DEFAULTS.down),
    burstPeak, burstMs: burstMs ? Number(burstMs[1]) : SCENE_TOKEN_DEFAULTS.burstMs,
    textCap: number("--scene-text-cap", SCENE_TOKEN_DEFAULTS.textCap),
    missing,
  };
}

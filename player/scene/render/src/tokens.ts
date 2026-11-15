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
  /** `--scene-house`: the house lights when the class is finished (white), a share of full. */
  readonly house: number;
  /** `--pattern-down`: a pattern's "down" side, a share of the "up" side's brightness. */
  readonly patternDown: number;
  /** `--m-change`: the colour cross at an interval change, ms (0 with reduced motion). */
  readonly changeMs: number;
  /** `--m-flash`: the lens flash at an interval change, ms (0 with reduced motion). */
  readonly flashMs: number;
  /** `--scene-text-cap`: the highest relative luminance of the scene under text (S2). */
  readonly textCap: number;
  /** Scene tokens that were not in tokens.css, so the spec's value was used. */
  readonly missing: readonly string[];
}

/** The spec's values for the scene-only tokens (scene.md "Tokens"), used only while tokens.css lacks them. */
export const SCENE_TOKEN_DEFAULTS = { down: 0.06, burstPeak: 0.85, burstMs: 250, textCap: 0.08, house: 0.4, patternDown: 0.72, changeMs: 700, flashMs: 160 } as const;

export function parseHex(value: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

/** Fails closed: only a bare positive number counts (`8 %` is not one), and the cap is never raised above the spec's 0.08. */
function textCap(raw: string, missing: string[]): number {
  const v = /^\s*(\d*\.?\d+)\s*$/.exec(raw);
  const n = v ? Number(v[1]) : NaN;
  if (!(n > 0)) {
    if (!missing.includes("--scene-text-cap")) missing.push("--scene-text-cap");
    return SCENE_TOKEN_DEFAULTS.textCap;
  }
  return Math.min(n, SCENE_TOKEN_DEFAULTS.textCap);
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
  /** A duration in ms (`700ms cubic-bezier(...)` gives 700; `0ms` is a real zero: reduced motion). */
  const duration = (name: string, fallback: number): number => {
    const m = /^\s*(\d*\.?\d+)\s*ms/.exec(style.getPropertyValue(name));
    if (m) return Number(m[1]);
    if (!missing.includes(name)) missing.push(name);
    return fallback;
  };
  return {
    zones, white: colour("--light-1"),
    house: Math.min(1, number("--scene-house", SCENE_TOKEN_DEFAULTS.house)),
    patternDown: Math.min(1, number("--pattern-down", SCENE_TOKEN_DEFAULTS.patternDown)),
    changeMs: duration("--m-change", SCENE_TOKEN_DEFAULTS.changeMs),
    flashMs: duration("--m-flash", SCENE_TOKEN_DEFAULTS.flashMs),
    down: number("--scene-down", SCENE_TOKEN_DEFAULTS.down),
    burstPeak, burstMs: burstMs ? Number(burstMs[1]) : SCENE_TOKEN_DEFAULTS.burstMs,
    textCap: textCap(style.getPropertyValue("--scene-text-cap"), missing),
    missing,
  };
}

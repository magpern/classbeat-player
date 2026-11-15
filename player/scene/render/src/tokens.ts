// The scene's design tokens, read from the screens lane's tokens.css (scene.md "Tokens"): the zone
// colours and the white are never kept in a table of the scene's own. The scene-only tokens that
// tokens.css does not hold yet fall back to the spec's values and are named in `missing`, so the
// screens lane's follow-up is visible. Pure: it reads through an accessor, never the DOM.

import type { ZoneNumber } from "../../model/src/index.ts";
import { HOLD_AFTER_MS, HOLD_BEFORE_MS, LENS_FLASH, LIFT_CAP, ZONES } from "../../model/src/index.ts";

export interface StyleSource {
  getPropertyValue(name: string): string;
}

export interface SceneTokens {
  /** `--zone-1` to `--zone-7`, as 0xRRGGBB. */
  readonly zones: Readonly<Record<ZoneNumber, number>>;
  /** `--light-1`: the white of the rig (bursts). */
  readonly white: number;
  /** `--scene-down`: lights down (paused), a share of full. */
  readonly down: number;
  /** `--scene-burst`: the drop burst's peak share of white. */
  readonly burstPeak: number;
  /** `--scene-burst`: the burst's decay, ms. */
  readonly burstMs: number;
  /** `--pattern-down`: a pattern's "down" side, a share of the "up" side's brightness. */
  readonly patternDown: number;
  /** `--scene-text-cap`: the highest relative luminance of the scene under text (S2). */
  readonly textCap: number;
  /** `--scene-lift-cap`: the largest run beat-like light may make alone in any region (the spec's 0.05; never raised). */
  readonly liftCap: number;
  /** `--scene-hold`: how long beat-like light is held at rest before a run starts and after it ends, ms (the spec's 250 and 300; never shortened). */
  readonly holdBeforeMs: number;
  readonly holdAfterMs: number;
  /** `--scene-lens-flash`: the white a lens gains at an interval change (the spec's 0.25; never raised). */
  readonly lensFlash: number;
  /** Scene tokens that were not in tokens.css, so the spec's value was used. */
  readonly missing: readonly string[];
  /** The flash budget's tokens (#577) that tokens.css does not hold yet: the screens lane adds them, and the spec's values are used until then. */
  readonly pending: readonly string[];
}

/** The spec's values for the scene-only tokens (scene.md "Tokens"), used only while tokens.css lacks them. */
export const SCENE_TOKEN_DEFAULTS = { down: 0.06, burstPeak: 0.85, burstMs: 250, textCap: 0.08, patternDown: 0.72 } as const;
/** The flash budget's tokens, as scene.md "Tokens" has them. A value from tokens.css only ever makes the budget stricter. */
export const BUDGET_TOKEN_DEFAULTS = { liftCap: LIFT_CAP, holdBeforeMs: HOLD_BEFORE_MS, holdAfterMs: HOLD_AFTER_MS, lensFlash: LENS_FLASH } as const;

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
  const pending: string[] = [];
  /** A budget token: a bare positive number, else the spec's value and the name in `pending`. */
  const budget = (name: string, spec: number, stricter: (n: number) => number): number => {
    const m = /^\s*(\d*\.?\d+)\s*$/.exec(style.getPropertyValue(name));
    if (m && Number(m[1]) > 0) return stricter(Number(m[1]));
    pending.push(name);
    return spec;
  };
  const hold = /^\s*(\d+)\s*ms\s+(\d+)\s*ms\s*$/.exec(style.getPropertyValue("--scene-hold"));
  if (hold === null) pending.push("--scene-hold");
  const burstRaw = style.getPropertyValue("--scene-burst");
  const burstMs = /(\d+)\s*ms/.exec(burstRaw);
  const burstPeak = number("--scene-burst", SCENE_TOKEN_DEFAULTS.burstPeak);
  return {
    zones, white: colour("--light-1"),
    patternDown: Math.min(1, number("--pattern-down", SCENE_TOKEN_DEFAULTS.patternDown)),
    down: number("--scene-down", SCENE_TOKEN_DEFAULTS.down),
    burstPeak, burstMs: burstMs ? Number(burstMs[1]) : SCENE_TOKEN_DEFAULTS.burstMs,
    textCap: textCap(style.getPropertyValue("--scene-text-cap"), missing),
    liftCap: budget("--scene-lift-cap", LIFT_CAP, (n) => Math.min(n, LIFT_CAP)),
    lensFlash: budget("--scene-lens-flash", LENS_FLASH, (n) => Math.min(n, LENS_FLASH)),
    holdBeforeMs: hold === null ? HOLD_BEFORE_MS : Math.max(HOLD_BEFORE_MS, Number(hold[1])),
    holdAfterMs: hold === null ? HOLD_AFTER_MS : Math.max(HOLD_AFTER_MS, Number(hold[2])),
    missing, pending,
  };
}

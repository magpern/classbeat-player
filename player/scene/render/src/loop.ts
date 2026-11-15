// The renderer's own per-frame loop, with no drawing in it: the model's step (clamp, phase, frame,
// turn-rate limiter), the bursts, the hue cross and the brightness of each part. `RigLoop.step`
// returns a `Draw`, which the rig applies to the scene's one shader; the drive tests run this loop and
// measure what the rig then holds. The renderer only draws what the model says: the beams'
// directions are the model's drawn directions, the moments are the model's gated ones, and a burst,
// the cross and the energy ramp are brightness and colour only.

import type { Direction, Energy, Frame, LinkInput, QualityLevel, RigHue, RigState, SceneClass } from "../../model/src/index.ts";
import { ANTICIPATION_MS, START_STATE, buildElapsedMs, buildHaze, energyFor, beatsAt, intervalIndexAt, rigFrozen, stepRig } from "../../model/src/index.ts";
import { RAMP_MS } from "./budget-calc.ts";
import { BurstTracker } from "./bursts.ts";
import { CROSS_MS, CrossGate, NO_CROSS, crossLook } from "./cross-calc.ts";
import type { CrossLook } from "./cross-calc.ts";
import { beatLift, beatStride, fixturesLit } from "./light-calc.ts";
import { NO_PATTERN_LIGHT, patternLight } from "./pattern-light-calc.ts";
import { movementScale, stageLit, stageMaster, stageOf } from "./stage-calc.ts";
import type { Stage } from "./stage-calc.ts";
import type { SceneTokens } from "./tokens.ts";
import { nth } from "./lookup.ts";

/** What the shell gives the scene each frame: the class clock's state, and nothing about riders. */
export interface Feed {
  readonly cls: SceneClass;
  readonly classMs: number;
  readonly songIndex: number;
  readonly songPosMs: number;
  readonly link: LinkInput;
  /** Reduced motion: the still rig (scene.md "Motion and reduced motion"). */
  readonly reducedMotion: boolean;
  /** "before" while the clock is ready and not started (the house look before the start); absent means running. */
  readonly stage?: Stage;
}

export interface Draw {
  /** What is drawn: one direction per fixture, from the model's turn-rate limiter. */
  readonly drawn: readonly Direction[];
  readonly frame: Frame;
  readonly dtSeconds: number;
  readonly lit: readonly boolean[];
  /** Added to every light of the rig, 0 to 0.05 (the flash budget); 0 while beat-like light is held around a run. */
  readonly lift: number;
  /** The beams' level: 1, or the down side's share in a position pattern (the accent of a side's first beat is in `lift`). */
  readonly beamLevel: number;
  /** The haze's gain in a build: a 3 % step a beat at the Beat level, steady light below it. */
  readonly hazeGain: number;
  /** The lens flash at an interval change, 0 to 1. */
  readonly lens: number;
  /** How far the energy has got from the zone left to the zone entered: the cross's ramp where the scheduler placed it, else 0 (a step in the change frame). */
  readonly energyRamp: number;
  /** The rig's master level: 1, 0.6 off the list, the down level paused or before the start a quarter after a song change. */
  readonly master: number;
  /** The white burst's share of its peak, 0 to 1. */
  readonly burst: number;
  readonly reduced: boolean;
  readonly stage: Stage;
  /** The two tokens in play: the planned zone's, and the next zone's from the start of the anticipation until the change. */
  readonly tokens: { readonly current: RigHue; readonly next: RigHue | null };
  /** The hue cross and the energy ramp at an interval change (none in the still rig, a frozen rig, or after a seek). */
  readonly cross: CrossLook;
  /** The next zone's energy and lit fixtures, while the energy ramps to them (null outside the cross). */
  readonly ahead: { readonly energy: Energy; readonly lit: readonly boolean[] } | null;
  /** The wall's chase step, null where there is no chase (no beat, or the still rig). */
  readonly chaseStep: number | null;
  /** The seconds the wall's wave and the haze drift on (frozen in the still rig). */
  readonly seconds: number;
}

/** The ramp is decided this long before the change: its hold starts 950 ms before it. */
const RAMP_HOLD_MS = 1500;
const FRAME_MS = 1000 / 60;

type LoopTokens = Pick<SceneTokens, "down" | "burstMs" | "patternDown" | "liftCap" | "holdBeforeMs" | "holdAfterMs">;

export class RigLoop {
  private state: RigState = START_STATE;
  private readonly bursts: BurstTracker;
  private readonly gate = new CrossGate();
  private seconds = 0;

  private readonly tokens: LoopTokens;

  constructor(tokens: LoopTokens) {
    this.tokens = tokens;
    this.bursts = new BurstTracker({ before: tokens.holdBeforeMs, after: tokens.holdAfterMs });
  }

  step(feed: Feed, rawDtSeconds: number, quality: QualityLevel): Draw {
    const { cls, classMs, songIndex, songPosMs, link, reducedMotion: reduced } = feed;
    const stage = stageOf(feed.stage);
    const still = reduced;
    const stepped = stepRig(this.state, { cls, classMs, songIndex, songPosMs, link, rawDtSeconds, still, motion: movementScale(stage, link), noMusic: stage === "before" });
    this.state = stepped.state;
    const { frame, dtSeconds } = stepped;
    const song = nth(cls.songs, songIndex);
    const beats = beatsAt(song?.anchors, songPosMs);
    const quiet = still || stage === "before";
    const { burst, dim, lens } = this.bursts.update({ cls, classMs, songIndex, songPosMs, link, level: frame.level, dtMs: dtSeconds * 1000, decayMs: this.tokens.burstMs, still: quiet });
    if (!still && link.state !== "Paused" && link.held !== true) this.seconds += dtSeconds;
    const at = intervalIndexAt(cls, classMs);
    const wipe = frame.colours.wipe;
    const msToChange = wipe > 0 ? (1 - wipe) * ANTICIPATION_MS : null;
    const startMs = nth(cls.intervals, at)?.startMs ?? 0;
    const asked = still || stage === "before" || rigFrozen(link) ? NO_CROSS : crossLook(msToChange, classMs - startMs, CROSS_MS);
    const cross = this.gate.filter(classMs, asked);
    // The energy ramp is a run: the scheduler places it in the 700 ms before the change or the energy is in the change frame.
    const t0 = nth(cls.intervals, at + 1)?.startMs;
    const rampPlaced = t0 !== undefined && msToChange !== null && msToChange <= RAMP_HOLD_MS && !quiet && !rigFrozen(link) &&
      this.bursts.budget.admit(`ramp@${t0}`, "ramp", [{ fromMs: t0 - RAMP_MS, toMs: t0 - FRAME_MS }], { cls, classMs, songIndex, songPosMs, level: frame.level });
    const nextEnergy = cross.front < 2 && rampPlaced && frame.colours.back.kind === "zone" ? energyFor(frame.colours.back.zone) : null;
    // Beat-like light: the beat lift (the pattern's accent in place of it on a side's first beat), held around every run.
    const pattern = patternLight({ cls, classMs, songIndex, songPosMs, level: frame.level, down: this.tokens.patternDown, still });
    const held = this.bursts.budget.held(classMs);
    const lifted = beatLift({ frame, bpm: song?.bpm, beats, songPosMs, reduced: still });
    const lift = held ? 0 : Math.min(this.tokens.liftCap, pattern.accent > 0 ? pattern.accent : lifted);
    const chase = !still && frame.level === "Beat" && beats !== null && song?.bpm !== undefined;
    const build = buildElapsedMs(song?.moments, song?.bpm, songPosMs);
    const beatMs = frame.level === "Beat" && song?.bpm !== undefined && song.bpm > 0 ? (60_000 / song.bpm) * beatStride(song.bpm) : null;
    return {
      drawn: stepped.drawn, frame, dtSeconds, lift, burst, reduced: still, stage, seconds: this.seconds, beamLevel: still ? NO_PATTERN_LIGHT.level : pattern.level, lens,
      hazeGain: still || !frame.moments.gather || build === null ? 1 : buildHaze(build, beatMs),
      energyRamp: rampPlaced ? cross.ramp : 0,
      tokens: { current: frame.colours.front, next: wipe > 0 ? frame.colours.back : null },
      cross,
      ahead: nextEnergy === null ? null : { energy: nextEnergy, lit: fixturesLit({ ...frame, energy: nextEnergy }, quality) },
      lit: stageLit(stage) ?? fixturesLit(frame, quality),
      master: stageMaster(stage, link, this.tokens, dim),
      chaseStep: chase ? Math.floor(beats / beatStride(song.bpm!)) : null,
    };
  }
}

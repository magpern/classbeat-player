// The renderer's own per-frame loop, with no drawing in it: the model's step (clamp, phase, frame,
// turn-rate limiter), the bursts, the hue cross and the brightness of each part. `RigLoop.step`
// returns a `Draw`, which the rig applies to the scene's one shader; the drive tests run this loop and
// measure what the rig then holds. The renderer only draws what the model says: the beams'
// directions are the model's drawn directions, the moments are the model's gated ones, and a burst,
// the cross and the energy ramp are brightness and colour only.

import type { Direction, Energy, Frame, LinkInput, QualityLevel, RigHue, RigState, SceneClass } from "../../model/src/index.ts";
import { ANTICIPATION_MS, START_STATE, beatLevel, buildElapsedMs, mergeIntervals, buildHaze, energyFor, beatsAt, intervalIndexAt, momentsAllowed, rigFrozen, stepRig } from "../../model/src/index.ts";
import { RAMP_MS, dropFrame } from "./budget-calc.ts";
import { BurstTracker } from "./bursts.ts";
import { CROSS_MS, CrossGate, NO_CROSS, crossLook } from "./cross-calc.ts";
import type { CrossLook } from "./cross-calc.ts";
import { beatLift, beatStride, fixturesLit, liftAgeMs } from "./light-calc.ts";
import { MarkHold } from "./mark-hold-calc.ts";
import { NO_PATTERN_LIGHT, patternLight } from "./pattern-light-calc.ts";
import { movementScale, stageLit, stageMaster, stageOf } from "./stage-calc.ts";
import { TextClock } from "./text-clock.ts";
import type { Shown } from "./text-clock.ts";
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
  /** The frame of a mark the hold placed for a change of the lit fixtures or the haze's gain (P2), on the frame it lands; else null. */
  readonly heldMark: number | null;
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
  /** What the text layer shows this frame: the class as it was on the last frame mark (the scheduler's, text rule 2). */
  readonly text: Shown;
}

/** The ramp is decided this long before the change, before the bursts (decided 1.5 s ahead), as the scheduler's order has it: its hold starts 950 ms before it. */
const RAMP_HOLD_MS = 1700;
const FRAME_MS = 1000 / 60;

const FAN_BEATS = 16;

/**
 * The fan's fixtures come on in the drop's frame (P1): a drop within 1 s of an interval change joins the change frame, light only, so
 * the fixtures are on from that frame to the end of the fan. The beams' turn and the hold-still stay on the song's drop moment (S7, rule 4),
 * so only which fixtures are lit moves; nothing here is an angle.
 */
function lightMoments(frame: Frame, at: { cls: SceneClass; classMs: number; songIndex: number; songPosMs: number; link: LinkInput }): Frame {
  const song = nth(at.cls.songs, at.songIndex);
  if (!momentsAllowed(at.link) || song?.bpm === undefined || !(song.bpm > 0)) return frame;
  const where = { cls: at.cls, classMs: at.classMs, songIndex: at.songIndex, songPosMs: at.songPosMs, level: frame.level };
  const offset = at.classMs - at.songPosMs;
  const joined = (song.moments ?? []).filter((m) => m.kind === "drop").map((m) => ({ m, frameMs: dropFrame(where, m.at_ms + offset) })).filter(({ m, frameMs }) => Math.abs(frameMs - (m.at_ms + offset)) > 20);
  const on = joined.some(({ m, frameMs }) => at.classMs >= frameMs && at.songPosMs < m.at_ms + (FAN_BEATS * 60_000) / song.bpm!);
  const waiting = joined.some(({ m, frameMs }) => at.classMs < frameMs && at.songPosMs >= m.at_ms); // the drop moment has come, its frame is later
  const fan = on || (frame.moments.fan && !waiting);
  return fan === frame.moments.fan ? frame : { ...frame, moments: { ...frame.moments, fan } };
}

type LoopTokens = Pick<SceneTokens, "down" | "burstMs" | "patternDown" | "liftCap" | "holdBeforeMs" | "holdAfterMs">;

export class RigLoop {
  private state: RigState = START_STATE;
  private readonly bursts: BurstTracker;
  private readonly gate = new CrossGate();
  private seconds = 0;

  private readonly tokens: LoopTokens;
  private holdPhase = false;
  private first = true;

  private readonly mergedClasses = new WeakMap<SceneClass, SceneClass>();
  private readonly clock = new TextClock();
  private readonly hold = new MarkHold();

  /** The text for this frame (the host calls it before the frame to paint the text; the same feed asked again gives the same answer). */
  shown(feed: Feed): Shown {
    return this.clock.step({ cls: this.merged(feed.cls), classMs: feed.classMs, songIndex: feed.songIndex, songPosMs: feed.songPosMs, link: feed.link, reducedMotion: feed.reducedMotion });
  }

  private merged(cls: SceneClass): SceneClass {
    const known = this.mergedClasses.get(cls);
    if (known !== undefined) return known;
    const made = mergeIntervals(cls);
    this.mergedClasses.set(cls, made);
    return made;
  }

  /** `budgetOff`: every run fits (the demo's `budget=off`, never the product). */
  constructor(tokens: LoopTokens, budgetOff = false) {
    this.tokens = tokens;
    this.bursts = new BurstTracker({ before: tokens.holdBeforeMs, after: tokens.holdAfterMs }, budgetOff);
  }

  /** The motion phase stops after the first frame, at its value on it (the steady-light gate's `steady=1`, never the product). */
  holdMotionPhase(): void {
    this.holdPhase = true;
  }

  step(feed: Feed, rawDtSeconds: number, quality: QualityLevel): Draw {
    const { classMs, songIndex, songPosMs, link, reducedMotion: reduced } = feed;
    const cls = this.merged(feed.cls); // interval changes under 1 s apart are one change frame (P1)
    const stage = stageOf(feed.stage);
    const still = reduced;
    const stepped = stepRig(this.state, { cls, classMs, songIndex, songPosMs, link, rawDtSeconds, still, motion: this.holdPhase && !this.first ? 0 : movementScale(stage, link), noMusic: stage === "before" });
    this.state = stepped.state;
    this.first = false;
    const { frame, dtSeconds } = stepped;
    const song = nth(cls.songs, songIndex);
    const beats = beatsAt(song?.anchors, songPosMs);
    const quiet = still || stage === "before";
    const at = intervalIndexAt(cls, classMs);
    const wipe = frame.colours.wipe;
    const msToChange = wipe > 0 ? (1 - wipe) * ANTICIPATION_MS : null;
    // The ramp is decided first (1.7 s ahead, step c), the bursts after (1.5 s ahead, steps e and f): steady light counts as one change in
    // every window, so a ramp, a change frame and a burst's decay do not all fit; the burst is then skipped, the fan comes on in the drop's frame.
    // The energy ramp is a run: the scheduler places it in the 700 ms before the change or the energy is in the change frame.
    const t0 = nth(cls.intervals, at + 1)?.startMs;
    const rampPlaced = t0 !== undefined && msToChange !== null && msToChange <= RAMP_HOLD_MS && !quiet && !rigFrozen(link) &&
      this.bursts.budget.admit(`ramp@${t0}`, "ramp", [{ fromMs: t0 - RAMP_MS, toMs: t0 - FRAME_MS }], { cls, classMs, songIndex, songPosMs, level: frame.level });
    const { burst, dim, lens } = this.bursts.update({ cls, classMs, songIndex, songPosMs, link, level: frame.level, dtMs: dtSeconds * 1000, decayMs: this.tokens.burstMs, still: quiet });
    if (!still && link.state !== "Paused" && link.held !== true) this.seconds += dtSeconds;
    const startMs = nth(cls.intervals, at)?.startMs ?? 0;
    const asked = still || stage === "before" || rigFrozen(link) ? NO_CROSS : crossLook(msToChange, classMs - startMs, CROSS_MS);
    const cross = this.gate.filter(classMs, asked);
    const nextEnergy = cross.front < 2 && rampPlaced && frame.colours.back.kind === "zone" ? energyFor(frame.colours.back.zone) : null;
    // Beat-like light: the beat lift (the pattern's accent in place of it on a side's first beat), held around every run.
    // The side's step (100 % and 72 %) is one frame on the count tick that shows the switch (S14, text rule 2); the accent stays on the beat.
    const text = this.shown(feed);
    const live = patternLight({ cls, classMs, songIndex, songPosMs, level: frame.level, down: this.tokens.patternDown, still });
    const shownLevel = beatLevel(text.link, nth(cls.songs, text.songIndex) ?? null);
    const side = patternLight({ cls, classMs: text.classMs, songIndex: text.songIndex, songPosMs: text.songPosMs, level: shownLevel, down: this.tokens.patternDown, still });
    const pattern = { ...live, level: side.level };
    const input = { frame, bpm: song?.bpm, beats, songPosMs, reduced: still };
    // A hold skips a lift that would start in it and never cuts one: it is decided on the lift's start.
    const started = (ageMs: number | null) => (ageMs === null ? classMs : classMs - ageMs);
    const accent = pattern.accent > 0;
    const skipped = this.bursts.budget.held(started(accent ? pattern.ageMs : liftAgeMs(input)));
    const lift = skipped ? 0 : Math.min(this.tokens.liftCap, accent ? pattern.accent : beatLift(input));
    const chase = !still && frame.level === "Beat" && beats !== null && song?.bpm !== undefined;
    const build = buildElapsedMs(song?.moments, song?.bpm, songPosMs);
    const beatMs = frame.level === "Beat" && song?.bpm !== undefined && song.bpm > 0 ? (60_000 / song.bpm) * beatStride(song.bpm) : null;
    // The lit fixtures and the haze's gain change on a planned mark only: a change between marks waits for the next one.
    const haze = still || !frame.moments.gather || build === null ? 1 : buildHaze(build, beatMs);
    const lit = stageLit(stage) ?? fixturesLit(lightMoments(frame, { cls, classMs, songIndex, songPosMs, link }), quality);
    const held = this.hold.step({ lit, haze }, { cls, classMs, songIndex, songPosMs, level: frame.level }, `${quality}|${stage}|${link.state}|${link.held === true}|${still}`);
    if (held.mark !== null) this.clock.note(held.mark);
    return {
      drawn: stepped.drawn, frame, dtSeconds, lift, burst, reduced: still, stage, seconds: this.seconds, beamLevel: still ? NO_PATTERN_LIGHT.level : pattern.level, lens,
      hazeGain: held.haze,
      heldMark: held.mark,
      energyRamp: rampPlaced ? cross.ramp : 0,
      tokens: { current: frame.colours.front, next: wipe > 0 ? frame.colours.back : null },
      cross,
      ahead: nextEnergy === null ? null : { energy: nextEnergy, lit: fixturesLit({ ...frame, energy: nextEnergy }, quality) },
      lit: [...held.lit],
      master: stageMaster(stage, link, this.tokens, dim),
      chaseStep: chase ? Math.floor(beats / beatStride(song.bpm!)) : null,
      text,
    };
  }
}

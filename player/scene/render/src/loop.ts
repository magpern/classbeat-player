// The renderer's own per-frame loop, with no drawing in it: the model's step (clamp, phase, frame,
// turn-rate limiter), the bursts and the brightness of each part. `RigLoop.step`
// returns a `Draw`, which the rig applies to the three.js scene; the drive tests run this loop and
// measure what the rig then holds. The renderer only draws what the model says: the beams'
// directions are the model's drawn directions, the moments are the model's gated ones, and a burst,
// a flash, a cross and a pattern's light are brightness and colour only.

import type { Direction, Frame, LinkInput, QualityLevel, RigHue, RigState, SceneClass } from "../../model/src/index.ts";
import { START_STATE, beatsAt, stepRig } from "../../model/src/index.ts";
import { BurstTracker } from "./bursts.ts";
import { beatLift, beatStride, fixturesLit } from "./light-calc.ts";
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
  /** Added to every lit beam's brightness, 0 to 0.55. */
  readonly lift: number;
  /** The rig's master level: 1, 0.6 off the list, the down level paused or before the start a quarter after a song change. */
  readonly master: number;
  /** The white burst's share of its peak, 0 to 1. */
  readonly burst: number;
  readonly reduced: boolean;
  readonly stage: Stage;
  /** The front truss, floor uplights and haze colour: the planned zone's. */
  readonly front: RigHue;
  /** The back truss and wall colour once the anticipation has reached them. */
  readonly back: RigHue;
  /** The wall's chase step, null where there is no chase (no beat, or the still rig). */
  readonly chaseStep: number | null;
  /** The seconds the wall's wave and the haze drift on (frozen in the still rig). */
  readonly seconds: number;
}

type LoopTokens = Pick<SceneTokens, "down" | "burstMs">;

export class RigLoop {
  private state: RigState = START_STATE;
  private readonly bursts = new BurstTracker();
  private seconds = 0;

  private readonly tokens: LoopTokens;

  constructor(tokens: LoopTokens) {
    this.tokens = tokens;
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
    const { burst, dim } = this.bursts.update({ cls, classMs, songIndex, songPosMs, link, dtMs: dtSeconds * 1000, decayMs: this.tokens.burstMs, still: quiet });
    if (!still && link.state !== "Paused" && link.held !== true) this.seconds += dtSeconds;
    const lift = beatLift({ frame, bpm: song?.bpm, beats, songPosMs, reduced: still });
    const chase = !still && frame.level === "Beat" && beats !== null && song?.bpm !== undefined;
    return {
      drawn: stepped.drawn, frame, dtSeconds, lift, burst, reduced: still, stage, seconds: this.seconds,
      front: frame.colours.front,
      back: frame.colours.back,
      lit: stageLit(stage) ?? fixturesLit(frame, quality),
      master: stageMaster(stage, link, this.tokens, dim),
      chaseStep: chase ? Math.floor(beats / beatStride(song.bpm!)) : null,
    };
  }
}

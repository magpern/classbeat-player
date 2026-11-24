// Mix playback for the open class (ADR 0013 sections 4 and 5), between the controller, the cache
// and the room window's <audio>. Every snapshot comes here: a Swedebeat class that names a mix
// starts its download when it opens, and at Start the mode policy picks the mix or the manual clock.
// On the mix, a play id is begun for the room window and the room is cued to the play URL; the
// room's reports steer the class clock to `audio position - offset_ms`. A fault (a chunk missing for
// 10 s, a chunk or the audio failing) ends the play and leaves the clock on its own, with the plain
// reason. Everything reaches the outside through the injected deps; no token passes here.
import { mixCueOf, mixPositionOf, steer } from "../../core/mix/audio-cue.ts";
import type { AudioReport, MixCue } from "../../core/mix/audio-cue.ts";
import { classMixOf } from "../../core/mix/class-mix.ts";
import type { ClassMix } from "../../core/mix/class-mix.ts";
import { mixLineOf } from "../../core/mix/mix-line.ts";
import type { MixLine, MixPlayState } from "../../core/mix/mix-line.ts";
import { modePolicy } from "../../core/mix/mode-policy.ts";
import type { FallbackReason, MixReadiness } from "../../core/mix/mode-policy.ts";
import { playUrl } from "../../core/mix/scheme-policy.ts";
import type { MixView } from "../../core/mix/view.ts";
import type { Snapshot } from "../../core/snapshot.ts";
import type { CacheOutcome, MixCache } from "./mix-cache.ts";
import type { PlayFault } from "./mix-response.ts";
import type { Play, Plays } from "./plays.ts";

export interface MixPlayerDeps {
  readonly cache: Pick<MixCache, "download" | "open" | "played" | "evict">;
  readonly plays: Plays;
  readonly view: () => MixView;
  /** The paired account's key, or null. */
  readonly account: () => string | null;
  /** The room window's webContents id, or null while it is closed. */
  readonly roomId: () => number | null;
  /** Sends the room window a cue (nothing when it is closed). */
  readonly cue: (c: MixCue) => void;
  /** Moves a running class clock to this class time (controller.ts `align`). */
  readonly align: (classMs: number) => void;
  /** Monotonic ms. */
  readonly now: () => number;
}

export interface MixPlayer {
  snapshot(s: Snapshot): void;
  report(r: AudioReport): void;
  /** From the scheme handler: the play's stream failed. */
  fault(playId: string, fault: PlayFault): void;
  /** The room window with this webContents id closed. */
  roomClosed(webContentsId: number): void;
  /** The room's link line for the open class, or null when it plays no mix. */
  line(): MixLine | null;
}

/** How often the download's progress and completeness are read. */
export const POLL_MS = 1000;
/** A clock further than this from where it should be was moved by a command: the audio seeks. */
export const JUMP_MS = 1000;
/** A cue the room has not answered for this long is sent again, fresh. */
export const UNANSWERED_MS = 2000;

const NOT_CHECKED: readonly CacheOutcome[] = ["bad", "not_found", "too_large"];

interface Run {
  readonly loadId: number;
  readonly mix: ClassMix | null;
  account: string | null;
  downloading: boolean;
  outcome: CacheOutcome | null;
  complete: boolean;
  percent: number;
  polledAt: number;
  started: boolean;
  status: string | null;
  state: MixPlayState | null;
  play: Play | null;
  cue: MixCue | null;
  cuedAt: number;
  answered: boolean;
  /** Where the clock was at the last snapshot, to tell a command's jump from time passing. */
  base: { classMs: number; at: number; running: boolean } | null;
}

const blank = (loadId: number, mix: ClassMix | null): Run => ({ loadId, mix, account: null, downloading: false, outcome: null, complete: false, percent: 0, polledAt: -Infinity, started: false, status: null, state: null, play: null, cue: null, cuedAt: 0, answered: false, base: null });

export function createMixPlayer(d: MixPlayerDeps): MixPlayer {
  let run = blank(0, null);
  let seq = 0;

  const send = (url: string | null, playing: boolean, classMs: number): void => {
    seq += 1;
    run.cue = { seq, url, playing, positionMs: url === null || run.mix === null ? 0 : mixPositionOf(classMs, run.mix.offsetMs) };
    run.cuedAt = d.now();
    run.answered = false;
    d.cue(mixCueOf(run.cue));
  };
  const stop = (): void => {
    if (run.play !== null) d.plays.end();
    run.play = null;
    if (run.cue?.url != null) send(null, false, 0);
  };
  const evict = (keep: readonly string[]): void => {
    // The first class opened has no download's account yet: the paired account's cache is swept.
    const a = run.account ?? d.account();
    if (a !== null) void d.cache.evict(a, { keep }).catch(() => undefined);
  };
  const fallBack = (reason: FallbackReason): void => {
    stop();
    run.state = { kind: "manual", reason, since: d.now() };
  };

  const download = (): void => {
    const a = d.account();
    if (run.mix === null || run.downloading || run.outcome !== null || a === null || d.view().state !== "signed_in") return;
    const mine = run;
    mine.account = a;
    mine.downloading = true;
    void d.cache.download(a, mine.mix!.id, [mine.mix!.id]).then(
      (o) => settle(mine, o),
      () => settle(mine, "unavailable"),
    );
  };
  const settle = (mine: Run, o: CacheOutcome): void => {
    mine.downloading = false;
    mine.outcome = o;
    mine.polledAt = -Infinity;
  };
  const poll = (): void => {
    const t = d.now();
    if (run.mix === null || run.account === null || t - run.polledAt < POLL_MS) return;
    run.polledAt = t;
    const mine = run;
    const reader = d.cache.open(mine.account!, mine.mix!.id);
    if (reader === null) return;
    mine.complete = reader.complete;
    if (reader.complete) mine.percent = 100;
    else void reader.written().then((n) => (mine.percent = reader.chunks > 0 ? (100 * n) / reader.chunks : 0), () => undefined);
  };
  const readiness = (): MixReadiness => {
    if (run.complete || run.outcome === "complete") return "ready";
    if (run.outcome === "not_allowed") return "not_allowed";
    if (run.outcome !== null && NOT_CHECKED.includes(run.outcome)) return "not_checked";
    // A download still running is streamed: the scheme waits up to 10 s for each chunk.
    return run.downloading ? "streaming" : "downloading";
  };
  const decide = (): ReturnType<typeof modePolicy> => {
    const v = d.view();
    return modePolicy({ musicSource: "swedebeat", hasMix: true, sourceAvailable: v.state !== "disabled", keychainUsable: v.keychainUsable, hasToken: v.state === "signed_in", readiness: readiness() });
  };
  const begin = (classMs: number, running: boolean): void => {
    const room = d.roomId();
    if (room === null || run.account === null || run.mix === null) return;
    run.play = d.plays.begin(room, run.account, run.mix.id);
    d.cache.played(run.account, run.mix.id);
    send(playUrl(run.play.id), running, classMs);
  };

  return {
    snapshot(s) {
      if (s.loadId !== run.loadId) {
        stop();
        const next = s.doc !== null && s.doc.music.source === "swedebeat" ? classMixOf(s.doc.music) : null;
        evict(next === null ? [] : [next.id]);
        run = blank(s.loadId, next);
      }
      if (run.mix === null || s.view === null) return;
      download();
      poll();
      const t = d.now();
      const { status, classMs } = s.view;
      const running = status === "running";
      const was = run.status;
      run.status = status;
      if (!run.started) {
        if (status === "ready") {
          const m = decide();
          run.state = m.mode === "manual" ? { kind: "manual", reason: m.reason, since: null } : run.complete || readiness() === "ready" ? { kind: "ready" } : { kind: "downloading", percent: run.percent };
          return;
        }
        run.started = true;
        const m = decide();
        if (m.mode !== "mix") {
          run.state = { kind: "manual", reason: m.mode === "manual" ? m.reason : "not_checked", since: null };
          return;
        }
        run.state = { kind: "playing" };
        begin(classMs, running);
        run.base = { classMs, at: t, running };
        return;
      }
      if (run.state?.kind !== "playing") return;
      if (status === "ended") {
        stop();
        evict([run.mix.id]);
        run.state = null;
        return;
      }
      // Signed out, or the play ended elsewhere: the audio has stopped.
      if (run.play !== null && d.plays.live(run.play.id) === null) return fallBack("downloading");
      const expected = run.base === null ? classMs : run.base.classMs + (run.base.running ? t - run.base.at : 0);
      run.base = { classMs, at: t, running };
      const jumped = Math.abs(classMs - expected) > JUMP_MS;
      if (run.play === null || run.play.webContentsId !== d.roomId()) begin(classMs, running);
      else if (status !== was || jumped || (!run.answered && t - run.cuedAt > UNANSWERED_MS)) send(playUrl(run.play.id), running, classMs);
    },
    report(r) {
      if (run.cue === null || run.cue.url === null || r.seq !== run.cue.seq || run.mix === null || run.state?.kind !== "playing") return;
      run.answered = true;
      if (r.failed) return fallBack("not_checked");
      const b = run.base;
      if (b === null || !b.running) return;
      const t = d.now();
      const want = steer(b.classMs + (t - b.at), r.positionMs, run.mix.offsetMs, run.mix.lengthMs);
      if (want === null) return;
      run.base = { classMs: want, at: t, running: true };
      d.align(want);
    },
    fault(playId, fault) {
      if (run.play?.id === playId && run.state?.kind === "playing") fallBack(fault);
    },
    roomClosed(webContentsId) {
      d.plays.endFor(webContentsId);
      if (run.play?.webContentsId === webContentsId) {
        run.play = null;
        run.cue = null;
      }
    },
    line() {
      if (run.status === "ended") return null;
      return mixLineOf(run.state, run.started, d.now());
    },
  };
}

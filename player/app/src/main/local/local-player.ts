// Local playback for the open class (ADR 0017 section 3), between the controller, the music-files
// check and the room window's two <audio> elements. Every snapshot comes here. A class whose music
// source is `local` is checked when it opens (the index and the folders already chosen, no dialog),
// and while it is ready each found file is opened once in the room window for its decoded length.
// At Start the mode policy picks local playback or the manual clock: one song missing is the manual
// clock. While it plays, the shell keeps the music time (where the files are), gives each sounding
// song a play id and cues the room; the owner song's reports steer the music time, and the class
// clock follows it (core/music-files/local-timing.ts). A file that fails, a decoded length that two
// reports confirm is wrong, or a sign-out stops the audio at once and leaves the clock running on its
// own. The hashes, the account and the play ids never leave this process except as play URLs.
import { DRIFT_MS, wrongLength } from "../../core/mix/audio-cue.ts";
import type { MusicLink } from "../../core/clock/music-link.ts";
import { localLink } from "../../core/clock/music-link.ts";
import type { FindAnswer } from "../../core/music-files/answer.ts";
import { EMPTY_SLOT } from "../../core/music-files/local-cue.ts";
import type { LocalCue, LocalReport, LocalSlotCue } from "../../core/music-files/local-cue.ts";
import { localModePolicy } from "../../core/music-files/local-mode-policy.ts";
import { localPlayUrl } from "../../core/music-files/local-scheme-policy.ts";
import { classTimeOf, fadeOf, ownerAt, slotsAt } from "../../core/music-files/local-timing.ts";
import type { Snapshot } from "../../core/snapshot.ts";
import type { LocalPlays } from "./local-plays.ts";
import { runOf } from "./local-run.ts";
import type { LocalPlayState, Slot } from "./local-run.ts";

export interface LocalPlayerDeps {
  readonly plays: LocalPlays;
  /** The check before playing for the open class's document (main/music-files/service.ts `checkOpen`); null while busy. */
  readonly check: (doc: unknown) => Promise<FindAnswer | null>;
  /** The paired account's key, or null. */
  readonly account: () => string | null;
  /** The room window's webContents id, or null while it is closed. */
  readonly roomId: () => number | null;
  /** Sends the room window a cue (nothing when it is closed). */
  readonly cue: (c: LocalCue) => void;
  /** Moves a running class clock to this class time (controller.ts `align`). */
  readonly align: (classMs: number) => void;
  /** Monotonic ms. */
  readonly now: () => number;
}

export type { LocalPlayState } from "./local-run.ts";

export interface LocalPlayer {
  snapshot(s: Snapshot): void;
  report(r: LocalReport): void;
  /** From the scheme handler: the play's file could not be read. */
  fault(playId: string): void;
  /** The room window with this webContents id closed. */
  roomClosed(webContentsId: number): void;
  /** Null when the open class is not a local one. */
  state(): LocalPlayState | null;
  /** The `local` music link: the owner song's latest reading. */
  link(): MusicLink;
}

/** A clock further than this from where it should be was moved by a command: the audio seeks. */
export const JUMP_MS = 1000;
/** A cue the room has not answered for this long is sent again, fresh. */
export const UNANSWERED_MS = 2000;
/** The check at Start that has not answered after this long is "not checked": the manual clock. */
export const CHECK_TIMEOUT_MS = 10_000;
/** A check that found the shell busy is asked again after this long. */
export const RECHECK_MS = 2000;

export function createLocalPlayer(d: LocalPlayerDeps): LocalPlayer {
  let run = runOf({ loadId: 0, doc: null } as Snapshot);
  let seq = 0;

  const musicNow = (): number => run.music.t + (run.music.running ? d.now() - run.music.at : 0);
  const send = (playing: boolean): void => {
    seq += 1;
    const t = musicNow();
    const slotCue = (s: Slot | null): LocalSlotCue => (s === null || run.timing === null ? EMPTY_SLOT : { url: localPlayUrl(s.play.id), positionMs: Math.max(0, t - run.timing.songs[s.k]!.startMs), fade: fadeOf(run.timing, s.k) });
    run.cue = { seq, playing, slots: [slotCue(run.slots[0]), slotCue(run.slots[1])] };
    run.cuedAt = d.now();
    run.answered = false;
    d.cue(run.cue);
  };
  const silence = (): void => {
    for (const s of run.slots) if (s !== null) d.plays.end(s.play.id);
    run.slots = [null, null];
    run.reading = null;
    if (run.cue !== null && run.cue.slots.some((s) => s.url !== null)) send(false);
  };
  const fallBack = (): void => {
    silence();
    run.state = { kind: "manual", reason: "failed" };
  };
  const beginPlay = (k: number): Slot | null => {
    const room = d.roomId();
    const w = run.wanted[k];
    if (room === null || run.account === null || w === undefined) return null;
    return { k, play: d.plays.begin({ webContentsId: room, account: run.account, loadId: run.loadId, songIndex: k, sha256: w.sha256, size: w.size }), duration: null };
  };

  const askCheck = (): void => {
    if (run.checking || d.now() - run.checkedAt < RECHECK_MS) return;
    const mine = run;
    mine.checking = true;
    mine.checkedAt = d.now();
    void d.check(mine.doc).then(
      (a) => {
        mine.checking = false;
        if (a !== null) mine.check = a;
      },
      () => {
        mine.checking = false;
      },
    );
  };
  const found = (k: number): boolean => run.check?.status === "done" && run.check.songs[k] === "found";

  /** Before Start: each found file opened once, paused and silent, in the first <audio>, for its decoded length. */
  const probe = (): void => {
    const cur = run.slots[0];
    if (cur !== null) {
      if (run.cue !== null && !run.answered && d.now() - run.cuedAt > UNANSWERED_MS) send(false);
      return;
    }
    run.account = d.account();
    const k = run.wanted.findIndex((_, i) => found(i) && !run.probed.has(i) && !run.bad.has(i));
    if (k < 0) return;
    const s = beginPlay(k);
    if (s === null) return;
    run.slots = [s, null];
    run.music = { t: run.timing!.songs[k]!.startMs, at: d.now(), running: false };
    send(false);
  };
  const probed = (k: number, bad: boolean): void => {
    run.probed.add(k);
    if (bad) run.bad.add(k);
    silence();
  };

  const place = (statusChanged: boolean, jumped: boolean, running: boolean): void => {
    // With the room window closed there is nothing to cue; the music time runs on and the plays begin when it opens.
    if (d.roomId() === null) return;
    const timing = run.timing!;
    const want = slotsAt(timing, musicNow());
    let changed = false;
    for (const i of [0, 1] as const) {
      const cur = run.slots[i];
      if (cur !== null && cur.k === want[i] && cur.play.webContentsId === d.roomId()) continue;
      if (cur === null && want[i] === null) continue;
      if (cur !== null) d.plays.end(cur.play.id);
      run.slots[i] = want[i] === null ? null : beginPlay(want[i]!);
      changed = true;
    }
    if (changed || statusChanged || jumped || (!run.answered && d.now() - run.cuedAt > UNANSWERED_MS)) send(running);
  };

  const playing = (classMs: number, running: boolean, statusChanged: boolean): void => {
    const t = d.now();
    if (d.account() !== run.account || run.slots.some((s) => s !== null && d.plays.live(s.play.id) === null)) return fallBack();
    const c = run.clock;
    const expected = c.running ? c.classMs + (t - c.at) : c.classMs;
    const jumped = Math.abs(classMs - expected) > JUMP_MS;
    run.clock = { classMs, at: t, running };
    run.music = { t: jumped ? classMs : musicNow(), at: t, running };
    place(statusChanged, jumped, running);
    // The class clock follows the music: held at the owner's `end_ms`, never past the class end.
    const want = classTimeOf(run.timing!, run.music.t);
    if (running && Math.abs(want - classMs) > DRIFT_MS) {
      run.clock = { classMs: want, at: t, running };
      d.align(want);
    }
  };

  /** At Start: the check again, then the mode policy; local playback begins at the class time the controller has reached. */
  const recheck = (): void => {
    const mine = run;
    const done = (a: FindAnswer | null): void => {
      if (run !== mine || !mine.starting) return;
      mine.starting = false;
      mine.check = a;
      const last = mine.last!;
      if (last.status === "ended") {
        mine.state = null;
        return;
      }
      // Signed out: the check has no account to read and says "failed", but the reason is the sign-out.
      mine.account = d.account();
      if (mine.account === null) {
        mine.state = { kind: "manual", reason: "failed" };
        return;
      }
      const m = localModePolicy({ musicSource: "local", songs: mine.wanted.length, check: mine.check, wrongLength: mine.bad });
      if (m.mode !== "local") {
        mine.state = m.mode !== "manual" ? { kind: "manual", reason: "not_checked" } : m.reason === "missing" ? { kind: "manual", reason: "missing", missing: m.missing } : { kind: "manual", reason: m.reason };
        return;
      }
      const running = last.status === "running";
      const t = d.now();
      const classMs = last.classMs + (running ? t - last.at : 0);
      mine.state = { kind: "playing" };
      mine.clock = { classMs, at: t, running };
      mine.music = { t: classMs, at: t, running };
      place(true, false, running);
    };
    void d.check(mine.doc).then(done, () => done(null));
  };

  return {
    snapshot(s) {
      if (s.loadId !== run.loadId) {
        silence();
        d.plays.endAll();
        run = runOf(s);
        if (run.timing !== null) run.state = { kind: "checking" };
      }
      if (run.timing === null || s.view === null) return;
      const { status, classMs } = s.view;
      const running = status === "running";
      const statusChanged = status !== run.status;
      run.status = status;
      if (!run.started) {
        if (status === "ready") {
          if (run.check === null) askCheck();
          else probe();
          run.state = run.check === null ? { kind: "checking" } : { kind: "ready" };
          return;
        }
        run.started = true;
        silence();
        // A file may have changed since the class opened: the check runs again before anything plays.
        run.starting = true;
        run.startedAt = d.now();
        run.last = { status, classMs, at: d.now() };
        run.state = { kind: "checking" };
        recheck();
        return;
      }
      if (run.starting) {
        run.last = { status, classMs, at: d.now() };
        // A second check that never answers must not hold the class silent and "checking" for good.
        if (d.now() - run.startedAt > CHECK_TIMEOUT_MS) {
          run.starting = false;
          run.state = { kind: "manual", reason: "not_checked" };
        }
        return;
      }
      if (run.state?.kind !== "playing") return;
      if (status === "ended") {
        silence();
        d.plays.endAll();
        run.state = null;
        return;
      }
      playing(classMs, running, statusChanged);
    },
    report(r) {
      if (run.cue === null || r.seq !== run.cue.seq || run.timing === null) return;
      const slot = run.slots[r.slot];
      if (slot === null) return;
      run.answered = true;
      // A decoded length counts once two reports in a row agree: an early estimate does not drop a song.
      const confirmed = r.durationMs !== null && r.durationMs === slot.duration;
      slot.duration = r.durationMs;
      const wrong = r.failed || (confirmed && wrongLength(r.durationMs, run.timing.songs[slot.k]!.lengthMs));
      if (!run.started) {
        if (wrong || confirmed) probed(slot.k, wrong);
        return;
      }
      if (run.state?.kind !== "playing") return;
      if (wrong) return fallBack();
      if (!r.playing || !run.music.running || ownerAt(run.timing, musicNow()) !== slot.k) return;
      const t = d.now();
      run.reading = { songIndex: slot.k, positionMs: r.positionMs, playing: true, at: t };
      // The owner's position is the music time; the next snapshot moves the class clock to it.
      const want = run.timing.songs[slot.k]!.startMs + r.positionMs;
      if (Math.abs(want - musicNow()) > DRIFT_MS) run.music = { t: want, at: t, running: true };
    },
    fault(playId) {
      const slot = run.slots.find((s) => s?.play.id === playId);
      if (slot === undefined || slot === null) return;
      if (!run.started) return probed(slot.k, true);
      if (run.state?.kind === "playing") fallBack();
    },
    roomClosed(webContentsId) {
      d.plays.endFor(webContentsId);
      if (run.slots.some((s) => s?.play.webContentsId === webContentsId)) {
        run.slots = [null, null];
        run.cue = null;
        run.reading = null;
      }
    },
    state: () => (run.timing === null ? null : run.state),
    link: () => localLink(() => run.reading),
  };
}

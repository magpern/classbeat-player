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
import { musicNoticeOf } from "../../core/music-files/music-notice.ts";
import type { LocalStop, MusicNotice } from "../../core/music-files/music-notice.ts";
import { classTimeOf, fadeOf, ownerAt, slotsAt } from "../../core/music-files/local-timing.ts";
import type { Snapshot } from "../../core/snapshot.ts";
import type { LocalPlays } from "./local-plays.ts";
import { askCheck, stopRecheck } from "./local-check.ts";
import { CHECK_TIMEOUT_MS, JUMP_MS, RECHECK_MS, UNANSWERED_MS, runOf, songTitle } from "./local-run.ts";
import type { LocalPlayState, Slot } from "./local-run.ts";

export interface LocalPlayerDeps {
  readonly plays: LocalPlays;
  /** The check before playing for the open class's document (main/music-files/service.ts `checkOpen`); null while busy. */
  readonly check: (doc: unknown) => Promise<FindAnswer | null>;
  /** Stops the check running (service.ts `cancel`): a Start check that timed out, or whose class was replaced, must not hold the service. */
  readonly cancelCheck: () => void;
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
export { CHECK_TIMEOUT_MS, JUMP_MS, RECHECK_MS, UNANSWERED_MS } from "./local-run.ts";
export interface LocalPlayer {
  snapshot(s: Snapshot): void;
  report(r: LocalReport): void;
  /** From the scheme handler: the play's file could not be read. */
  fault(playId: string): void;
  /** The room window with this webContents id closed. */
  roomClosed(webContentsId: number): void;
  /** Null when the open class is not a local one. */
  state(): LocalPlayState | null;
  /** What the presenter says while a local class is on the manual clock (core/music-files/music-notice.ts); null otherwise. */
  notice(): MusicNotice | null;
  /** The `local` music link: the owner song's latest reading. */
  link(): MusicLink;
}

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
  /** The audio stops for the class: `song` is the one that failed (null: the sign-out), `why` the plain reason (never a path or a decode message). */
  const fallBack = (song: number | null, why: LocalStop["why"]): void => {
    silence();
    run.failure = { song, why };
    run.state = { kind: "manual", reason: "failed" };
  };
  const beginPlay = (k: number): Slot | null => {
    const room = d.roomId();
    const w = run.wanted[k];
    if (room === null || run.account === null || w === undefined) return null;
    return { k, play: d.plays.begin({ webContentsId: room, account: run.account, loadId: run.loadId, songIndex: k, sha256: w.sha256, size: w.size }), duration: null };
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
    if (d.account() !== run.account) return fallBack(null, "signed_out");
    if (run.slots.some((s) => s !== null && d.plays.live(s.play.id) === null)) return fallBack(run.slots.find((s) => s !== null)?.k ?? null, "read");
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
      // The files service was busy (a check of the list's own): asked again when it is free, until CHECK_TIMEOUT_MS.
      if (a === null && d.now() - mine.startedAt < CHECK_TIMEOUT_MS) return void (mine.retryAt = d.now() + RECHECK_MS);
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
        mine.failure = { song: null, why: "signed_out" };
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
    mine.rechecking = true;
    const settled = (a: FindAnswer | null): void => {
      mine.rechecking = false;
      done(a);
    };
    void d.check(mine.doc).then(settled, () => settled(null));
  };

  return {
    snapshot(s) {
      if (s.loadId !== run.loadId) {
        silence();
        d.plays.endAll();
        stopRecheck(d, run);
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
          if (run.check === null) askCheck(d, run);
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
        if (run.retryAt !== null && d.now() >= run.retryAt) {
          run.retryAt = null;
          recheck();
        }
        // A second check that never answers must not hold the class silent and "checking" for good.
        if (d.now() - run.startedAt > CHECK_TIMEOUT_MS) {
          run.starting = false;
          stopRecheck(d, run);
          run.state = { kind: "manual", reason: "not_checked" };
        }
        return;
      }
      // The class ended: a manual state and its notice end with it (the plate stays "until it is closed or the class ends").
      if (status === "ended" && run.state?.kind === "manual") run.state = run.failure = null;
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
      if (wrong) return fallBack(slot.k, r.failed ? "read" : "length");
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
      if (run.state?.kind === "playing") fallBack(slot.k, "read");
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
    notice: () => (run.timing === null || run.state?.kind !== "manual" ? null : musicNoticeOf(run.state, run.failure, run.failure?.song == null ? null : songTitle(run.doc, run.failure.song))),
    link: () => localLink(() => run.reading),
  };
}

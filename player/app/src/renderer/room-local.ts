// The room window's two <audio> elements for local playback (ADR 0017 section 3): each does what its
// slot of the shell's cue says and tells the shell where it is. It gets only the cue (per slot a
// `cbp-local://play/<id>` URL or none, a position and the song's fade; play or pause) and answers
// through the one callback it is given; it reaches no preload, no network and no file. Each element
// sets its own gain from its position, equal-power over an overlap (core/music-files/local-cue.ts
// `gainAt`), and pauses at its song's stop. The shell steers the class clock from the reports.
import { gainAt, parseLocalCue } from "../core/music-files/local-cue.ts";
import type { Fade } from "../core/music-files/local-cue.ts";

/** What one element says back: the cue answered, its slot, the position in ms, playing, failed, and the decoded length in ms (null: not known yet). */
export type LocalReportFn = (seq: number, slot: 0 | 1, positionMs: number, playing: boolean, failed: boolean, durationMs: number | null) => void;

export interface LocalDriver {
  /** A cue from the shell; one that is malformed or older than the last is ignored. */
  cue(raw: unknown): void;
  /** Stops the reports and the gain updates (the page is going away). */
  stop(): void;
}

/** How often each element reports where it is. */
export const REPORT_MS = 1000;
/** How often each element's gain follows its position: smooth enough for a fade, cheap enough to idle. */
export const GAIN_MS = 50;
/** An element already this close to the cued position is not moved: a resent cue does not stutter. */
export const SEEK_MS = 250;

interface Element {
  readonly audio: HTMLAudioElement;
  readonly slot: 0 | 1;
  hasSource: boolean;
  fade: Fade | null;
  failedFor: number;
}

export function mountLocal(audios: readonly [HTMLAudioElement, HTMLAudioElement], report: LocalReportFn, every: (fn: () => void, ms: number) => () => void = interval): LocalDriver {
  let seq = -1;
  let playing = false;
  const els: Element[] = audios.map((audio, i) => ({ audio, slot: i === 1 ? 1 : 0, hasSource: false, fade: null, failedFor: -1 }));
  const posOf = (a: HTMLAudioElement): number => Math.max(0, Math.round(a.currentTime * 1000));
  const say = (e: Element, failed: boolean): void => {
    if (seq < 1 || !e.hasSource) return;
    const d = e.audio.duration;
    report(seq, e.slot, posOf(e.audio), !e.audio.paused, failed, Number.isFinite(d) && d >= 0 ? Math.round(d * 1000) : null);
  };
  const fail = (e: Element): void => {
    // Once per cue: the shell stops the audio and sends an empty cue.
    if (!e.hasSource || e.failedFor === seq) return;
    e.failedFor = seq;
    say(e, true);
  };
  /** The gain at the element's position, and a pause once its song's stop is reached. */
  const follow = (e: Element): void => {
    if (!e.hasSource || e.fade === null) return;
    const p = e.audio.currentTime * 1000;
    e.audio.volume = gainAt(p, e.fade);
    if (p >= e.fade.stopMs && !e.audio.paused) e.audio.pause();
  };
  for (const e of els) {
    // The decoded length is known or changed: the shell acts on a length only once two reports agree.
    e.audio.addEventListener("loadedmetadata", () => say(e, false));
    e.audio.addEventListener("durationchange", () => say(e, false));
    e.audio.addEventListener("error", () => fail(e));
  }
  const stopReports = every(() => els.forEach((e) => say(e, false)), REPORT_MS);
  const stopGain = every(() => els.forEach(follow), GAIN_MS);

  const apply = (e: Element, url: string | null, positionMs: number, fade: Fade): void => {
    if (url === null) {
      e.hasSource = false;
      e.fade = null;
      e.audio.pause();
      e.audio.removeAttribute("src");
      e.audio.load();
      return;
    }
    const fresh = !e.hasSource || e.audio.getAttribute("src") !== url;
    if (fresh) e.audio.src = url;
    e.hasSource = true;
    e.fade = fade;
    if (fresh || Math.abs(e.audio.currentTime * 1000 - positionMs) > SEEK_MS) e.audio.currentTime = positionMs / 1000;
    e.audio.volume = gainAt(positionMs, fade);
    if (playing && positionMs < fade.stopMs) {
      e.audio.play().catch(() => fail(e));
    } else {
      e.audio.pause();
    }
  };

  return {
    cue(raw) {
      const c = parseLocalCue(raw);
      if (c === null || c.seq <= seq) return;
      seq = c.seq;
      playing = c.playing;
      els.forEach((e, i) => apply(e, c.slots[i]!.url, c.slots[i]!.positionMs, c.slots[i]!.fade));
    },
    stop() {
      stopReports();
      stopGain();
    },
  };
}

function interval(fn: () => void, ms: number): () => void {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

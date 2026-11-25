// The room window's one <audio> (ADR 0013 section 5): it does what the shell's cue says and tells
// the shell where it is. It gets only the cue (a `cbp-mix://play/<id>` URL or none, play or pause,
// a position) and answers through the one callback it is given; it reaches no preload, no network
// and no file. The shell steers the class clock from the reports, never the other way round here.
import { parseMixCue } from "../core/mix/audio-cue.ts";

/** What the room says back: the cue answered, the position in ms, playing, whether it failed, and the decoded length in ms (null: not known yet). */
export type MixReport = (seq: number, positionMs: number, playing: boolean, failed: boolean, durationMs: number | null) => void;

export interface MixDriver {
  /** A cue from the shell; one that is malformed or older than the last is ignored. */
  cue(raw: unknown): void;
  /** Stops the reports (the page is going away). */
  stop(): void;
}

/** How often the room reports where the audio is. */
export const REPORT_MS = 1000;

export function mountMix(audio: HTMLAudioElement, report: MixReport, every: (fn: () => void, ms: number) => () => void = interval): MixDriver {
  let seq = -1;
  let hasSource = false;
  let failedFor = -1;
  const say = (failed: boolean): void => {
    if (seq < 1 || !hasSource) return;
    const d = audio.duration;
    report(seq, Math.max(0, Math.round(audio.currentTime * 1000)), !audio.paused, failed, Number.isFinite(d) && d >= 0 ? Math.round(d * 1000) : null);
  };
  // The decoded length is known: the shell checks it against the class's at once, not a second later.
  audio.addEventListener("loadedmetadata", () => say(false));
  audio.addEventListener("error", () => {
    // Once per cue: the shell falls back to the manual clock and sends an empty cue.
    if (!hasSource || failedFor === seq) return;
    failedFor = seq;
    say(true);
  });
  const stopReports = every(() => say(false), REPORT_MS);
  return {
    cue(raw) {
      const c = parseMixCue(raw);
      if (c === null || c.seq <= seq) return;
      seq = c.seq;
      if (c.url === null) {
        hasSource = false;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        return;
      }
      if (!hasSource || audio.getAttribute("src") !== c.url) audio.src = c.url;
      hasSource = true;
      audio.currentTime = c.positionMs / 1000;
      if (c.playing) {
        audio.play().catch(() => {
          if (failedFor === seq) return;
          failedFor = seq;
          say(true);
        });
      } else {
        audio.pause();
      }
    },
    stop: stopReports,
  };
}

function interval(fn: () => void, ms: number): () => void {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

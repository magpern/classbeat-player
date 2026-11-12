// The Linux follower (ADR 0001, option A, best effort): Spotify's MPRIS interface on the session
// D-Bus, through busctl. Main process only. It runs nothing until the instructor picks Follow,
// never starts Spotify, uses no Spotify token and no network. Every call is one of the fixed
// argument lists in core/link/linux-calls.ts, run without a shell, with a timeout; a failed, hung
// or unreadable call (no busctl, no session bus, Spotify not running) leaves the last reading to
// age (rule 8) and never throws. The lifecycle is the macOS reader's (main/macos-reader.ts), with
// two additions. While Spotify is not playing, the other players on the bus are asked whether
// they play: one that does is reported as another player, which the link shows as off the list
// (ADR 0001); it is never followed and never sent a command. And no command is sent to Spotify
// before Spotify has given a first good reading.
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { BUSCTL, LINUX_CALLS, LINUX_MAX_OUTPUT_BYTES, LINUX_POLL_MS, LINUX_TIMEOUT_MS, otherPlayerArgs } from "../core/link/linux-calls.ts";
import { asOtherPlayer, parseLinuxOutput, parseOtherPlayers } from "../core/link/linux-parse.ts";
import type { LinuxParse } from "../core/link/linux-parse.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport, TransportAction } from "../core/link/transport.ts";
import type { Observation } from "../core/link/types.ts";

export interface ExecOptions {
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly killSignal: "SIGKILL";
  readonly windowsHide: true;
  readonly shell: false;
  readonly encoding: "utf8";
}

export type ExecFileFn = (file: string, args: readonly string[], options: ExecOptions, done: (error: Error | null, stdout: string) => void) => void;

export const EXEC_OPTIONS: ExecOptions = Object.freeze({
  timeout: LINUX_TIMEOUT_MS,
  maxBuffer: LINUX_MAX_OUTPUT_BYTES,
  killSignal: "SIGKILL",
  windowsHide: true,
  shell: false,
  encoding: "utf8",
});

/** A call that has not answered after this long is given up (the system kills it at the timeout). */
export const GIVE_UP_MS = 2 * LINUX_TIMEOUT_MS;

const systemExec: ExecFileFn = (file, args, options, done) => {
  execFile(file, [...args], options, (error, stdout) => done(error, stdout));
};

const systemEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export interface LinuxDeps {
  readonly exec?: ExecFileFn;
  readonly now?: () => number;
  /** Starts a repeating timer and returns the function that stops it. */
  readonly every?: (fn: () => void, ms: number) => () => void;
}

export interface LinuxMusic extends MusicReader, MusicTransport {
  readonly kind: "linux";
  setActive(on: boolean): void;
}

export function createLinuxMusic(deps: LinuxDeps = {}): LinuxMusic {
  const runFile = deps.exec ?? systemExec;
  const now = deps.now ?? (() => performance.now());
  const every = deps.every ?? systemEvery;

  let last: Observation | null = null;
  let stopTimer: (() => void) | null = null;
  // One read and one command at a time. `since` is when the call in flight began; an answer to
  // anything but the newest call (following stopped meanwhile, or the call was given up) is dropped.
  let readSince: number | null = null;
  let readCall = 0;
  let sendSince: number | null = null;
  let sendCall = 0;
  // A command sent while another is in flight waits here: at most one, and a newer one replaces
  // an older one (the instructor's latest intent wins). It is never dropped silently.
  let waiting: TransportAction | null = null;
  // True once Spotify itself has given a good reading since following began: before that nothing
  // is known to be there, and no command is sent.
  let ready = false;
  const inFlight = (since: number | null, t: number): boolean => since !== null && t - since < GIVE_UP_MS;

  /** Runs one call from core/link/linux-calls.ts; `done` gets its output, or null on any failure or timeout. */
  function run(args: readonly string[] | null, done: (stdout: string | null) => void): void {
    let answered = false;
    const once = (stdout: string | null): void => {
      if (answered) return;
      answered = true;
      done(stdout);
    };
    if (args === null) return once(null);
    try {
      runFile(BUSCTL, args, EXEC_OPTIONS, (error, stdout) => once(error === null && typeof stdout === "string" ? stdout : null));
    } catch {
      once(null);
    }
  }

  /** One poll: Spotify first; only while it is not playing, whether another player is. */
  function poll(): void {
    const before = now();
    if (stopTimer === null || inFlight(readSince, before)) return;
    const mine = ++readCall;
    // One call of this poll. Its answer is dropped once the poll is no longer the newest one.
    const ask = (args: readonly string[] | null, done: (stdout: string | null, began: number, ended: number) => void): void => {
      const began = now();
      readSince = began;
      run(args, (stdout) => {
        if (mine === readCall) done(stdout, began, now());
      });
    };
    // A reading is dated inside its own call (the midpoint). When that time cannot be told (the
    // clock did not move forward across the call) there is no reading: it is never dated "now",
    // and the last one goes on aging (rule 8).
    const parse = (stdout: string | null, began: number, ended: number): LinuxParse | null =>
      stdout !== null && Number.isFinite(began) && Number.isFinite(ended) && ended >= began ? parseLinuxOutput(stdout, (began + ended) / 2, ended) : null;
    const settle = (own: LinuxParse | null): void => {
      readSince = null;
      if (own?.kind === "reading") last = own.obs;
      else if (own?.kind === "closed") last = null;
    };

    ask(LINUX_CALLS.read, (stdout, began, ended) => {
      const own = parse(stdout, began, ended);
      if (own?.kind === "reading") ready = true;
      if (own?.kind === "reading" && own.obs.playing) return settle(own);
      ask(LINUX_CALLS.names, (list) => {
        const others = list === null ? [] : parseOtherPlayers(list);
        const tryOther = (i: number): void => {
          if (i >= others.length) return settle(own);
          ask(otherPlayerArgs(others[i]), (out, b, e) => {
            const other = parse(out, b, e);
            if (other?.kind !== "reading" || !other.obs.playing) return tryOther(i + 1);
            readSince = null;
            last = asOtherPlayer(other.obs);
          });
        };
        tryOther(0);
      });
    });
  }

  function sendNow(action: TransportAction): void {
    waiting = null;
    sendSince = now();
    const mine = ++sendCall;
    run(LINUX_CALLS[action], () => {
      if (mine !== sendCall) return;
      sendSince = null;
      const next = waiting;
      if (next !== null && stopTimer !== null) sendNow(next);
    });
  }

  return {
    kind: "linux",
    latest: () => last,
    setActive(on) {
      if (on === (stopTimer !== null)) return;
      if (on) {
        stopTimer = every(poll, LINUX_POLL_MS);
        poll();
        return;
      }
      stopTimer?.();
      stopTimer = null;
      readCall += 1;
      readSince = null;
      sendCall += 1;
      sendSince = null;
      waiting = null;
      ready = false;
      last = null;
    },
    send(action) {
      if (stopTimer === null || !ready) return;
      if (inFlight(sendSince, now())) waiting = action;
      else sendNow(action);
    },
  };
}

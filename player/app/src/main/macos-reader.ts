// The macOS follower (ADR 0001, option A): Spotify's AppleScript interface through osascript.
// Main process only. It runs nothing until the instructor picks Follow, never starts Spotify,
// uses no Spotify token and no network. Every call is one of the fixed scripts in
// core/link/macos-scripts.ts, run without a shell, with a timeout; a failed, hung or unreadable
// call leaves the last reading to age (rule 8) and never throws.
import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { parseMacOutput } from "../core/link/macos-parse.ts";
import { MAC_MAX_OUTPUT_BYTES, MAC_POLL_MS, MAC_TIMEOUT_MS, OSASCRIPT, osascriptArgs } from "../core/link/macos-scripts.ts";
import type { MacScriptName } from "../core/link/macos-scripts.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport } from "../core/link/transport.ts";
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
  timeout: MAC_TIMEOUT_MS,
  maxBuffer: MAC_MAX_OUTPUT_BYTES,
  killSignal: "SIGKILL",
  windowsHide: true,
  shell: false,
  encoding: "utf8",
});

/** A call that has not answered after this long is given up (the system kills it at the timeout). */
export const GIVE_UP_MS = 2 * MAC_TIMEOUT_MS;

const systemExec: ExecFileFn = (file, args, options, done) => {
  execFile(file, [...args], options, (error, stdout) => done(error, stdout));
};

const systemEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

export interface MacDeps {
  readonly exec?: ExecFileFn;
  readonly now?: () => number;
  /** Starts a repeating timer and returns the function that stops it. */
  readonly every?: (fn: () => void, ms: number) => () => void;
}

export interface MacMusic extends MusicReader, MusicTransport {
  readonly kind: "macos";
  setActive(on: boolean): void;
}

export function createMacMusic(deps: MacDeps = {}): MacMusic {
  const runFile = deps.exec ?? systemExec;
  const now = deps.now ?? (() => performance.now());
  const every = deps.every ?? systemEvery;

  let last: Observation | null = null;
  let stopTimer: (() => void) | null = null;
  // One call of each kind at a time. `since` is when the call in flight began; an answer to
  // anything but the newest call (following stopped meanwhile, or the call was given up) is dropped.
  let readSince: number | null = null;
  let readCall = 0;
  let sendSince: number | null = null;
  let sendCall = 0;
  const inFlight = (since: number | null, t: number): boolean => since !== null && t - since < GIVE_UP_MS;

  /** Runs one allowlisted script; `done` gets its output, or null on any failure or timeout. */
  function run(name: MacScriptName, done: (stdout: string | null) => void): void {
    let answered = false;
    const once = (stdout: string | null): void => {
      if (answered) return;
      answered = true;
      done(stdout);
    };
    const args = osascriptArgs(name);
    if (args === null) return once(null);
    try {
      runFile(OSASCRIPT, args, EXEC_OPTIONS, (error, stdout) => once(error === null && typeof stdout === "string" ? stdout : null));
    } catch {
      once(null);
    }
  }

  function poll(): void {
    const before = now();
    if (stopTimer === null || inFlight(readSince, before)) return;
    readSince = before;
    const mine = ++readCall;
    run("read", (stdout) => {
      if (mine !== readCall) return;
      readSince = null;
      if (stdout === null) return;
      const after = now();
      // The position was read somewhere inside the call: take the midpoint.
      const parsed = parseMacOutput(stdout, (before + after) / 2, after);
      if (parsed.kind === "reading") last = parsed.obs;
      else if (parsed.kind === "closed") last = null;
    });
  }

  return {
    kind: "macos",
    latest: () => last,
    setActive(on) {
      if (on === (stopTimer !== null)) return;
      if (on) {
        stopTimer = every(poll, MAC_POLL_MS);
        poll();
        return;
      }
      stopTimer?.();
      stopTimer = null;
      readCall += 1;
      readSince = null;
      last = null;
    },
    send(action) {
      const t = now();
      if (stopTimer === null || inFlight(sendSince, t)) return;
      sendSince = t;
      const mine = ++sendCall;
      run(action, () => {
        if (mine === sendCall) sendSince = null;
      });
    },
  };
}

// The macOS follower (ADR 0001, option A): Spotify's AppleScript interface through osascript.
// Main process only. It runs nothing until the instructor picks Follow, never starts Spotify,
// uses no Spotify token and no network. Every call is one of the fixed scripts in
// core/link/macos-scripts.ts, run without a shell, with a timeout; a failed, hung or unreadable
// call leaves the last reading to age (rule 8) and never throws. This module holds only the
// helper (osascript) and the parsing; when it runs, which reading it holds and when a command
// may go are the shared lifecycle's (core/link/reader-lifecycle.ts, main/polled-reader.ts).
import { execFile } from "node:child_process";
import { parseMacOutput } from "../core/link/macos-parse.ts";
import { reasonForFailure } from "../core/link/macos-reason.ts";
import { MAC_FIRST_READ_MS, MAC_MAX_OUTPUT_BYTES, MAC_POLL_MS, MAC_TIMEOUT_MS, OSASCRIPT, osascriptArgs } from "../core/link/macos-scripts.ts";
import type { MusicReader, NoReadingReason } from "../core/link/reader.ts";
import type { MusicTransport } from "../core/link/transport.ts";
import { callWith, createPolledReader, systemEvery, systemNow } from "./polled-reader.ts";
import type { ExecFileFn, ExecOptions, PollDeps } from "./polled-reader.ts";

export type { ExecFileFn, ExecOptions } from "./polled-reader.ts";

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

/** Until Spotify has answered once, a read may wait for the Automation prompt (then it is killed). */
export const FIRST_READ_OPTIONS: ExecOptions = Object.freeze({ ...EXEC_OPTIONS, timeout: MAC_FIRST_READ_MS });
/** A first read given up after this long (its own limit, and a second for the system to kill it). */
export const FIRST_GIVE_UP_MS = MAC_FIRST_READ_MS + 1000;

const systemExec: ExecFileFn = (file, args, options, done) => {
  execFile(file, [...args], options, (error, stdout) => done(error, stdout));
};

export type MacDeps = PollDeps;

export interface MacMusic extends MusicReader, MusicTransport {
  readonly kind: "macos";
  setActive(on: boolean): void;
  unavailable(): boolean;
  /** Why the last read gave no reading (not running, not permitted, not answering, script failed). */
  reason(): NoReadingReason | null;
}

export function createMacMusic(deps: MacDeps = {}): MacMusic {
  const now = deps.now ?? systemNow;
  const run = deps.exec ?? systemExec;
  /** Runs one allowlisted command script, by its name. */
  const call = callWith(run, OSASCRIPT, EXEC_OPTIONS, now);

  /** Spotify has answered once, so macOS let us ask and the short limit is safe. */
  let permitted = false;
  let why: NoReadingReason | null = null;
  /** Only the newest read may say why: a given-up call that answers late must not. */
  let newest = 0;

  /**
   * The read call. Before the first answer it waits for the Automation prompt; after that a read
   * past the normal limit counts as not answering even if the runner ignored the limit.
   */
  const readRun: ExecFileFn = (file, args, _options, done) => {
    const mine = ++newest;
    const began = now();
    const limit = permitted ? MAC_TIMEOUT_MS : MAC_FIRST_READ_MS;
    run(file, args, permitted ? EXEC_OPTIONS : FIRST_READ_OPTIONS, (error, stdout) => {
      const late = error === null && now() - began > limit;
      const failure = late ? Object.assign(new Error("read took too long"), { killed: true }) : error;
      if (mine === newest) why = failure === null ? null : reasonForFailure(failure);
      done(failure, failure === null ? stdout : "");
    });
  };
  const read = callWith(readRun, OSASCRIPT, EXEC_OPTIONS, now);

  const life = createPolledReader(
    {
      pollMs: MAC_POLL_MS,
      giveUpMs: GIVE_UP_MS,
      readGiveUpMs: () => (permitted ? GIVE_UP_MS : FIRST_GIVE_UP_MS),
      read: (done) => read(osascriptArgs("read"), done),
      parse(out, at, seenAt) {
        const parsed = parseMacOutput(out, at, seenAt);
        if (parsed.kind === "garbage") {
          why = "script-failed";
          return null;
        }
        if (out.trim() === "notrunning") why = "not-running";
        else permitted = true; // Spotify itself answered (a read, or stopped)
        return parsed;
      },
      command: (action, done) => call(osascriptArgs(action), () => done()),
      stopped() {
        why = null;
        newest++;
      },
    },
    now,
    deps.every ?? systemEvery,
  );

  return { kind: "macos", latest: life.latest, setActive: life.setActive, send: life.send, unavailable: life.unavailable, reason: () => why };
}

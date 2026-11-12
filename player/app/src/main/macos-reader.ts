// The macOS follower (ADR 0001, option A): Spotify's AppleScript interface through osascript.
// Main process only. It runs nothing until the instructor picks Follow, never starts Spotify,
// uses no Spotify token and no network. Every call is one of the fixed scripts in
// core/link/macos-scripts.ts, run without a shell, with a timeout; a failed, hung or unreadable
// call leaves the last reading to age (rule 8) and never throws. This module holds only the
// helper (osascript) and the parsing; when it runs, which reading it holds and when a command
// may go are the shared lifecycle's (core/link/reader-lifecycle.ts, main/polled-reader.ts).
import { execFile } from "node:child_process";
import { parseMacOutput } from "../core/link/macos-parse.ts";
import { MAC_MAX_OUTPUT_BYTES, MAC_POLL_MS, MAC_TIMEOUT_MS, OSASCRIPT, osascriptArgs } from "../core/link/macos-scripts.ts";
import type { MusicReader } from "../core/link/reader.ts";
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

const systemExec: ExecFileFn = (file, args, options, done) => {
  execFile(file, [...args], options, (error, stdout) => done(error, stdout));
};

export type MacDeps = PollDeps;

export interface MacMusic extends MusicReader, MusicTransport {
  readonly kind: "macos";
  setActive(on: boolean): void;
  unavailable(): boolean;
}

export function createMacMusic(deps: MacDeps = {}): MacMusic {
  const now = deps.now ?? systemNow;
  /** Runs one allowlisted script, by its name. */
  const call = callWith(deps.exec ?? systemExec, OSASCRIPT, EXEC_OPTIONS, now);

  const life = createPolledReader(
    {
      pollMs: MAC_POLL_MS,
      giveUpMs: GIVE_UP_MS,
      read: (done) => call(osascriptArgs("read"), done),
      parse(out, at, seenAt) {
        const parsed = parseMacOutput(out, at, seenAt);
        return parsed.kind === "garbage" ? null : parsed;
      },
      command: (action, done) => call(osascriptArgs(action), () => done()),
    },
    now,
    deps.every ?? systemEvery,
  );

  return { kind: "macos", latest: life.latest, setActive: life.setActive, send: life.send, unavailable: life.unavailable };
}

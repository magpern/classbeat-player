// What the macOS and the Linux follower share at their edge: both ask the music app with one
// short-lived call per poll. This module times the polls, keeps one read in flight, gives up a
// call that never answers, dates a reading inside its own call (rule 8) and hands every answer to
// the shared lifecycle (core/link/reader-lifecycle.ts). It starts no process itself: a follower
// passes in its own call (one fixed program, fixed arguments, no shell), and nothing here throws.
import { performance } from "node:perf_hooks";
import { createCallSlot } from "../core/link/call-slot.ts";
import { createReaderLifecycle } from "../core/link/reader-lifecycle.ts";
import type { Answer, ReaderLifecycle } from "../core/link/reader-lifecycle.ts";
import type { TransportAction } from "../core/link/transport.ts";

export interface ExecOptions {
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly killSignal: "SIGKILL";
  readonly windowsHide: true;
  readonly shell: false;
  readonly encoding: "utf8";
}

export type ExecFileFn = (file: string, args: readonly string[], options: ExecOptions, done: (error: Error | null, stdout: string) => void) => void;

export interface PollDeps {
  readonly exec?: ExecFileFn;
  readonly now?: () => number;
  /** Starts a repeating timer and returns the function that stops it. */
  readonly every?: (fn: () => void, ms: number) => () => void;
}

export const systemNow = (): number => performance.now();

export const systemEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  timer.unref();
  return () => clearInterval(timer);
};

/** The system's errors for a program that is not there or may not be run. */
const NO_START: readonly unknown[] = ["ENOENT", "EACCES", "EPERM", "ENOEXEC"];

/** True when the error says the program was never started (not: it ran and failed, or was killed). */
export const couldNotStart = (error: unknown): boolean => typeof error === "object" && error !== null && NO_START.includes((error as { code?: unknown }).code);

/** One finished call: its output, or null on any failure or timeout, and when it began and ended. */
export interface Called {
  readonly out: string | null;
  /** False when the program could not be started at all. */
  readonly started: boolean;
  readonly began: number;
  readonly ended: number;
}

export type Call = (args: readonly string[] | null, done: (called: Called) => void) => void;

/** Makes the follower's call: `done` is called exactly once, whatever the program or `runFile` does. */
export function callWith(runFile: ExecFileFn, file: string, options: ExecOptions, now: () => number): Call {
  return (args, done) => {
    const began = now();
    let answered = false;
    const once = (out: string | null, started: boolean): void => {
      if (answered) return;
      answered = true;
      done({ out, started, began, ended: now() });
    };
    if (args === null) return once(null, true);
    try {
      runFile(file, args, options, (error, stdout) => once(error === null && typeof stdout === "string" ? stdout : null, !couldNotStart(error)));
    } catch {
      once(null, false);
    }
  };
}

/**
 * A reading is dated inside its own call: the midpoint. Null when that time cannot be told (the
 * clock did not move forward across the call): such an answer is never dated "now" (rule 8).
 */
export function midpoint(called: Called): number | null {
  const { began, ended } = called;
  return Number.isFinite(began) && Number.isFinite(ended) && ended >= began ? (began + ended) / 2 : null;
}

export interface PolledSpec {
  readonly pollMs: number;
  /** A call that has not answered after this long is given up (the system kills it earlier). */
  readonly giveUpMs: number;
  /** Starts the one read call. */
  read(done: (called: Called) => void): void;
  /** The read call's output as an answer; null when it is not one. */
  parse(out: string, at: number, seenAt: number): Answer | null;
  /** Starts the call for one command; its output is ignored. */
  command(action: TransportAction, done: () => void): void;
  /** After each read that ran: what it answered (null: nothing usable), and whether it was held. */
  afterRead?(answer: Answer | null, held: boolean): void;
  /** Following stopped. */
  stopped?(): void;
}

export function createPolledReader(spec: PolledSpec, now: () => number, every: (fn: () => void, ms: number) => () => void): ReaderLifecycle {
  const reads = createCallSlot(now, spec.giveUpMs);
  let stopTimer: (() => void) | null = null;

  const life = createReaderLifecycle(
    { now, giveUpMs: spec.giveUpMs },
    {
      start() {
        stopTimer = every(poll, spec.pollMs);
        poll();
      },
      stop() {
        stopTimer?.();
        stopTimer = null;
        reads.clear();
        spec.stopped?.();
      },
      command: (action, taken) => spec.command(action, taken),
    },
  );

  function poll(): void {
    if (!life.active || reads.busy()) return;
    // A read given up without any answer is an unusable answer: a command that waited for it goes with it.
    if (reads.lapsed()) life.failed(true);
    const ticket = reads.begin();
    spec.read((called) => {
      if (!ticket.end()) return;
      const at = midpoint(called);
      const answer = called.out === null || at === null ? null : spec.parse(called.out, at, called.ended);
      if (answer === null) life.failed(called.started);
      const held = answer !== null && life.answer(answer);
      // A program that could not be started is not asked anything more for this poll.
      if (life.active && called.started) spec.afterRead?.(answer, held);
    });
  }

  return life;
}

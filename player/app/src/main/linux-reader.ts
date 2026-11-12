// The Linux follower (ADR 0001, option A, best effort): Spotify's MPRIS interface on the session
// D-Bus, through busctl. Main process only. It runs nothing until the instructor picks Follow,
// never starts Spotify, uses no Spotify token and no network. Every call is one of the fixed
// argument lists in core/link/linux-calls.ts, run without a shell, with a timeout; a failed, hung
// or unreadable call (no session bus, Spotify not running) leaves the last reading to age
// (rule 8) and never throws. This module holds only the helper (busctl) and the parsing; when it
// runs, which reading it holds and when a command may go are the shared lifecycle's
// (core/link/reader-lifecycle.ts, main/polled-reader.ts).
//
// One thing is the Linux follower's own. While Spotify is not playing, the other players on the
// bus are asked whether they play: one that does is reported as another player, which the link
// shows as off the list (ADR 0001); it is never followed and never sent a command. They are
// asked beside the polls of Spotify, never in their way: Spotify's own reading is stored when its
// call answers, and a player that hangs or fails only means it is not known to play.
import { execFile } from "node:child_process";
import { createCallSlot } from "../core/link/call-slot.ts";
import { BUSCTL, LINUX_CALLS, LINUX_MAX_OUTPUT_BYTES, LINUX_POLL_MS, LINUX_TIMEOUT_MS, otherPlayerArgs } from "../core/link/linux-calls.ts";
import { otherPlayerReading, parseLinuxOutput, parseOtherPlayers } from "../core/link/linux-parse.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport } from "../core/link/transport.ts";
import type { Observation } from "../core/link/types.ts";
import { callWith, createPolledReader, midpoint, systemEvery, systemNow } from "./polled-reader.ts";
import type { Called, ExecFileFn, ExecOptions, PollDeps } from "./polled-reader.ts";

export type { ExecFileFn, ExecOptions } from "./polled-reader.ts";

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

export type LinuxDeps = PollDeps;

export interface LinuxMusic extends MusicReader, MusicTransport {
  readonly kind: "linux";
  setActive(on: boolean): void;
  unavailable(): boolean;
}

export function createLinuxMusic(deps: LinuxDeps = {}): LinuxMusic {
  const now = deps.now ?? systemNow;
  /** Runs one call from core/link/linux-calls.ts. */
  const call = callWith(deps.exec ?? systemExec, BUSCTL, EXEC_OPTIONS, now);

  // Another player that plays while Spotify does not. It stands in front of Spotify's own
  // reading until a later round finds no player playing, or Spotify plays again.
  let other: Observation | null = null;
  // One round of asking the other players at a time; each call in it has its own time to answer.
  const rounds = createCallSlot(now, GIVE_UP_MS);

  function askOthers(): void {
    if (rounds.busy()) return;
    const round = rounds.begin();
    const ask = (args: readonly string[] | null, done: (called: Called) => void): void => {
      round.renew();
      call(args, (called) => {
        if (round.current()) done(called);
      });
    };
    ask(LINUX_CALLS.names, (list) => {
      const names = list.out === null ? [] : parseOtherPlayers(list.out);
      const tryOther = (i: number): void => {
        if (i >= names.length) {
          round.end();
          other = null;
          return;
        }
        ask(otherPlayerArgs(names[i]), (called) => {
          const at = midpoint(called);
          const parsed = called.out === null || at === null ? null : parseLinuxOutput(called.out, at, called.ended);
          // A player that fails, hangs or says anything else is not known to play: on to the next.
          if (parsed?.kind !== "reading" || !parsed.obs.playing) return tryOther(i + 1);
          round.end();
          other = otherPlayerReading(names[i], parsed.obs.at, parsed.obs.seenAt);
        });
      };
      tryOther(0);
    });
  }

  const forgetOthers = (): void => {
    rounds.clear();
    other = null;
  };

  const life = createPolledReader(
    {
      pollMs: LINUX_POLL_MS,
      giveUpMs: GIVE_UP_MS,
      read: (done) => call(LINUX_CALLS.read, done),
      parse(out, at, seenAt) {
        const parsed = parseLinuxOutput(out, at, seenAt);
        return parsed.kind === "garbage" ? null : parsed;
      },
      command: (action, done) => call(LINUX_CALLS[action], () => done()),
      afterRead(answer, held) {
        // Spotify plays: it is followed, and nothing else is asked.
        if (answer?.kind === "reading" && answer.obs.playing && !held) return forgetOthers();
        // A status between two songs, held for this poll: the others are not asked either.
        if (!held) askOthers();
      },
      stopped: forgetOthers,
    },
    now,
    deps.every ?? systemEvery,
  );

  return { kind: "linux", latest: () => other ?? life.latest(), setActive: life.setActive, send: life.send, unavailable: life.unavailable };
}

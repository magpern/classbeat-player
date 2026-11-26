// The phone's follower (ADR 0011 §6, issue #632): the desktop followers' interface (MusicReader)
// over instructor mode's follow intents. Native code reads; this only asks it, once per poll, and
// hands each answer to the shared lifecycle (player/app/src/core/link/reader-lifecycle.ts), so the
// phone follows by the same rules as the desktop: a garbage or failed answer changes nothing and
// the last good reading ages (rule 8), and stopping forgets it. Native code that cannot follow
// ("unavailable": the phone has no media sessions at all) stops the reader for good, and
// the shell stays on the manual clock. Nothing here plays, fetches or stores audio, and it sends
// no command to the music app.
import { createReaderLifecycle } from "../../../app/src/core/link/reader-lifecycle.ts";
import type { MusicReader, NoReadingReason } from "../../../app/src/core/link/reader.ts";
import { observationOf, parseFollow, parseReading } from "./answers.ts";

/** Instructor mode's follow intents, as bridge.ts carries them. */
export interface FollowIntents {
  follow(): Promise<unknown>;
  unfollow(): Promise<unknown>;
  reading(): Promise<unknown>;
}

export interface AndroidReaderDeps {
  /** Monotonic time in ms. */
  now(): number;
  /** Starts a repeating timer and returns the function that stops it. */
  every(fn: () => void, ms: number): () => void;
}

/** How often native code is asked: well inside the 3 s after which a reading is stale. */
export const POLL_MS = 500;

export function createAndroidReader(intents: FollowIntents, deps: AndroidReaderDeps): MusicReader {
  let gone = false;
  let reason: NoReadingReason | null = null;
  /** Bumped on every start and stop: an answer to an older run is dropped. */
  let run = 0;
  let stopTimer: (() => void) | null = null;
  let asking = false;

  const halt = (): void => {
    stopTimer?.();
    stopTimer = null;
    asking = false;
  };

  const poll = (mine: number): void => {
    if (asking) return;
    asking = true;
    const calledAt = deps.now();
    intents.reading().then(
      (reply) => {
        if (mine !== run) return;
        asking = false;
        answered(parseReading(reply), calledAt, deps.now());
      },
      () => {
        if (mine !== run) return;
        asking = false;
        reason = "not-answering";
        life.failed(true);
      },
    );
  };

  const answered = (a: ReturnType<typeof parseReading>, calledAt: number, answeredAt: number): void => {
    if (a === null) {
      reason = "not-answering";
      return life.failed(true);
    }
    if (a.kind === "reading") {
      const obs = observationOf(a.fields, calledAt, answeredAt);
      if (obs === null) return life.failed(true);
      reason = null;
      life.answer({ kind: "reading", obs });
      return;
    }
    if (a.kind === "nothing") {
      reason = "not-running";
      life.answer({ kind: "closed" });
      return;
    }
    // Access taken back, following stopped by native code, or no way to follow: the reader stops.
    stopped(a.kind === "noAccess" ? "not-permitted" : "not-answering", a.kind === "unavailable");
  };

  const stopped = (why: NoReadingReason, forGood: boolean): void => {
    reason = why;
    if (forGood) gone = true;
    life.setActive(false);
  };

  const life = createReaderLifecycle(
    { now: deps.now, giveUpMs: Infinity },
    {
      start() {
        const mine = ++run;
        intents.follow().then(
          (reply) => {
            if (mine !== run) return;
            const state = parseFollow(reply);
            if (state === "following") stopTimer = deps.every(() => poll(mine), POLL_MS);
            else stopped(state === "noAccess" ? "not-permitted" : "not-answering", state === "unavailable");
          },
          () => {
            if (mine === run) stopped("not-answering", false);
          },
        );
      },
      stop() {
        run++;
        halt();
        intents.unfollow().catch(() => undefined);
      },
      // No command reaches the music app from here yet (the real reader, #653).
      command(_action, taken) {
        taken();
      },
    },
  );

  return {
    kind: "android",
    latest: () => life.latest(),
    setActive(on) {
      if (on && gone) return;
      if (on) reason = null;
      life.setActive(on);
    },
    unavailable: () => gone,
    reason: () => reason,
  };
}

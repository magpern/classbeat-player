// Holds the app's quit, for a bounded time, while the phone remote may still leave a session on the
// backend (#205; ADR 0005 section 2, "Ending"): a start request whose answer has not come, which is
// then ended, an `end` sent on the host's own connection and not yet answered (#211), or an ender
// still trying. Without it the session would stay until the live process's
// own 15 minutes. The windows are already closed; nothing is shown while it waits. Then the app
// exits, whatever is left: a session not ended in time ends on the backend by itself.
// The app is launched again during the wait (#211): this instance still holds the single-instance
// lock, so the new one quits at once and this one is told. It is then started again on exit.

/** The most the quit waits for the phone remote's session to be ended. */
export const QUIT_WAIT_MS = 5_000;

/** The part of the live service the quit uses. */
export interface QuitLive {
  stop(): void;
  busy(): boolean;
  settled(): Promise<void>;
}

export interface QuitDeps {
  readonly live: () => QuitLive | null;
  /** Ends the process without another will-quit: the other will-quit work has already run. */
  readonly exit: () => void;
  /** Starts the app again once this process has exited (Electron's app.relaunch). */
  readonly relaunch: () => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface Quit {
  /** The will-quit listener: ends the session, then lets the quit go on at once or after the wait. */
  readonly willQuit: (e: { preventDefault(): void }) => void;
  /** Another launch of the app (second-instance): true when it came during the wait and is kept for after it. */
  readonly launchedAgain: () => boolean;
}

export function quitAfterLive(d: QuitDeps): Quit {
  let stopped = false;
  let waiting = false;
  let exited = false;
  let again = false;
  const willQuit = (e: { preventDefault(): void }): void => {
    if (exited) return;
    const live = d.live();
    if (!stopped) {
      stopped = true;
      live?.stop();
    }
    if (waiting) return e.preventDefault();
    if (live === null || !live.busy()) return;
    e.preventDefault();
    waiting = true;
    let timer: unknown = null;
    const exit = (): void => {
      if (exited) return;
      exited = true;
      d.clearTimer(timer);
      if (again) d.relaunch();
      d.exit();
    };
    timer = d.setTimer(exit, QUIT_WAIT_MS);
    void live.settled().then(exit, exit);
  };
  const launchedAgain = (): boolean => {
    if (!waiting || exited) return false;
    again = true;
    return true;
  };
  return { willQuit, launchedAgain };
}

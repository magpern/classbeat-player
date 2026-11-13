// Holds the app's quit, for a bounded time, while the phone remote may still leave a session on the
// backend (#205; ADR 0005 section 2, "Ending"): a start request whose answer has not come, which is
// then ended, or an ender still trying. Without it the session would stay until the live process's
// own 15 minutes. The windows are already closed; nothing is shown while it waits. Then the app
// exits, whatever is left: a session not ended in time ends on the backend by itself.

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
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/** The will-quit listener: ends the session, then lets the quit go on at once or after the wait. */
export function quitAfterLive(d: QuitDeps): (e: { preventDefault(): void }) => void {
  let stopped = false;
  let waiting = false;
  let exited = false;
  return (e) => {
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
      d.exit();
    };
    timer = d.setTimer(exit, QUIT_WAIT_MS);
    void live.settled().then(exit, exit);
  };
}

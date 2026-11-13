// Ends on the backend a live session the host is not in (#203; ADR 0005 section 2, "Ending"): one
// still starting when the instructor ended it or another class opened, or one whose connection is
// being made or tried again. The only way to end a session is `end` from the host, so this opens a
// connection of its own, sends `hello` with the host token and, on `welcome`, `end`. It sends
// nothing else, publishes no state and takes no command. A few tries, then the live process's own
// 15 minutes. A try whose `end` may not have arrived (the connection dropped with 1006, or no
// answer in time) is tried again: a session already ended answers the next `hello` with 4401 or
// 4403 (#205). The token is in this closure's memory only and leaves it only in `hello`.
import { parseHostFrame } from "../../core/live/host-wire.ts";
import { CLOSE_ABNORMAL, CLOSE_ENDED, CLOSE_HELLO_REFUSED, CLOSE_REPLACED } from "../../core/live/session-model.ts";
import type { LiveSocket, SocketEvents } from "./live-socket.ts";

/** When each try starts after the one before failed: at once, then after 1 and 2 s. */
export const END_TRIES_MS: readonly number[] = [0, 1000, 2000];
/** How long one try waits for the session to be ended before it gives up on that connection. */
export const END_TRY_MS = 10_000;

/** Close codes after which there is nothing left to end. */
const GONE: readonly number[] = [CLOSE_ENDED, CLOSE_HELLO_REFUSED, CLOSE_REPLACED];

export interface EnderDeps {
  /** Opens one connection to the live socket of the backend the session was started on. */
  readonly open: (on: SocketEvents) => LiveSocket;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/** Whether a try that closed with this code is tried again: unless the session is gone, or `end`
 * was sent and the connection closed cleanly (so `end` arrived). */
export function tryAgainAfter(code: number, endSent: boolean): boolean {
  return !GONE.includes(code) && (!endSent || code === CLOSE_ABNORMAL);
}

/** Resolves once the session is ended or gone, or the last try is over. Never rejects. */
export function endSession(d: EnderDeps, token: string): Promise<void> {
  return new Promise((finished) => attempt(d, token, 0, finished));
}

function attempt(d: EnderDeps, token: string, n: number, finished: () => void): void {
  let settled = false;
  let endSent = false;
  let socket: LiveSocket | null = null;
  let timer: unknown = null;
  // One outcome per try: done (the session is ended or gone), or the next try, if any is left.
  const settle = (again: boolean): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) d.clearTimer(timer);
    socket?.close();
    const next = END_TRIES_MS[n + 1];
    if (again && next !== undefined) d.setTimer(() => attempt(d, token, n + 1, finished), next);
    else finished();
  };
  // No answer in time: whether or not `end` went out, it is not known to have arrived.
  timer = d.setTimer(() => settle(true), END_TRY_MS);
  socket = d.open({
    open: () => {
      if (!settled) socket?.send(JSON.stringify({ v: 1, type: "hello", token }));
    },
    message: (text) => {
      if (settled) return;
      const m = parseHostFrame(text);
      if (m?.type === "welcome" && !endSent) {
        endSent = true;
        socket?.send(JSON.stringify({ v: 1, type: "end" }));
      } else if (m?.type === "ended") {
        settle(false);
      }
    },
    closed: (code) => {
      // The server closes every connection with 4403 once the session is ended.
      settle(tryAgainAfter(code, endSent));
    },
  });
}

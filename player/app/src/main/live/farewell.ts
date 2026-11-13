// Ends a live session the host is in, on the host's own connection (#211; ADR 0005 section 2,
// "Ending"): `end` goes out as the run's last message, within the send budget, and the connection
// is kept until the session is ended, so the quit can wait for it (quit.ts). The live process
// answers `ended` and closes every connection with 4403. If `end` may not have arrived (it could
// not be queued, the connection dropped with 1006, or no answer came in time), the ender (ender.ts)
// ends the session on a connection of its own. Only `ended` is read: a command or any other
// message that still comes is not taken. No token passes through here.
import { parseHostFrame } from "../../core/live/host-wire.ts";
import { END_TRY_MS, tryAgainAfter } from "./ender.ts";
import type { LiveSocket } from "./live-socket.ts";

export interface FarewellDeps {
  /** The host's connection, which `end` goes out on. */
  readonly socket: LiveSocket;
  /** Queues `end` as the run's last message and tells `sent` once it has gone; false if it could not be queued. */
  readonly sendEnd: (sent: () => void) => boolean;
  /** Ends the session on a connection of its own (the ender), for when `end` may not have arrived. */
  readonly endElsewhere: () => Promise<void>;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface Farewell {
  /** The host connection's messages, from the `end` on. */
  message(text: string): void;
  /** The host connection's close, told once. */
  closed(code: number): void;
  /** Resolves once the session is ended or gone, or the ender's last try is over. Never rejects. */
  readonly done: Promise<void>;
}

export function farewell(d: FarewellDeps): Farewell {
  let settled = false;
  let endSent = false;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));
  // One outcome: ended here, or handed to the ender. Either way the host's connection is closed.
  const settle = (again: boolean): void => {
    if (settled) return;
    settled = true;
    d.clearTimer(timer);
    d.socket.close();
    if (again) d.endElsewhere().then(finish, finish);
    else finish();
  };
  // No answer in time: whether or not `end` went out, it is not known to have arrived.
  const timer = d.setTimer(() => settle(true), END_TRY_MS);
  if (!d.sendEnd(() => void (endSent = true))) settle(true);
  return {
    message(text) {
      if (!settled && parseHostFrame(text)?.type === "ended") settle(false);
    },
    closed(code) {
      settle(tryAgainAfter(code, endSent));
    },
    done,
  };
}

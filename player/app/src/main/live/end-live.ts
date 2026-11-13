// Ends a run the host is in (#211, #216; ADR 0005 section 2, "Ending"): the `end_live` effect. The
// run's connection and publisher are handed in, already detached from the service, so nothing else
// uses them. With both and the session's backend, `end` goes out on the host's own connection and
// the farewell (farewell.ts) waits for the answer. Without one of them the connection is closed
// and the publisher stopped at once, and the session is ended on a connection of its own (the
// ender) when its backend is known. The token goes only to the ender, only for that backend.
import { farewell } from "./farewell.ts";
import type { Farewell } from "./farewell.ts";
import type { LiveSocket } from "./live-socket.ts";
import type { Publisher } from "./publisher.ts";

export interface EndLiveDeps {
  /** Ends the session on a connection of its own, on the backend `at`. */
  readonly ender: (at: string, token: string) => Promise<void>;
  /** Keeps a step for the quit (live-service.ts). */
  readonly track: (p: Promise<unknown>) => void;
  /** The farewells by connection number: the host connection's events go to its farewell. */
  readonly farewells: Map<number, Farewell>;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface EndingRun {
  /** The backend the session was started on, if known. */
  readonly at: string | null;
  readonly socket: LiveSocket | null;
  readonly publisher: Publisher | null;
  /** The connection's number. */
  readonly n: number;
  readonly token: string;
}

export function endLive(d: EndLiveDeps, x: EndingRun): void {
  const { at, socket: s, publisher: p, n, token } = x;
  if (at === null || s === null || p === null) {
    s?.close();
    p?.stop();
    // Only to the backend the session was started on, never to another address.
    if (at !== null) d.track(d.ender(at, token));
    return;
  }
  const { farewells } = d;
  const forget = (): void => {
    farewells.delete(n);
    p.stop();
  };
  const f = farewell({
    socket: s,
    sendEnd: (sent) => p.last({ v: 1, type: "end" }, sent),
    endElsewhere: () => d.ender(at, token),
    stop: () => p.stop(),
    register: (g) => void farewells.set(n, g),
    setTimer: d.setTimer,
    clearTimer: d.clearTimer,
  });
  d.track(f.done.then(forget, forget));
}

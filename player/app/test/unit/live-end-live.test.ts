// Ending a run the host is in (#216; src/main/live/end-live.ts), directly: every branch closes the
// run's connection and stops its publisher, and the session is ended elsewhere only on the backend
// it was started on. With no backend address nothing is dialled and the token goes nowhere.
// Fakes only: no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { endLive } from "../../src/main/live/end-live.ts";
import type { EndLiveDeps } from "../../src/main/live/end-live.ts";
import type { Farewell } from "../../src/main/live/farewell.ts";
import type { Publisher } from "../../src/main/live/publisher.ts";
import { HOST_TOKEN, ORIGIN } from "./live-relay.ts";

interface Seen {
  closed: number;
  stopped: number;
  sent: string[];
  enders: { at: string; token: string }[];
  tracked: number;
  timers: number;
}

function parts(): { seen: Seen; deps: EndLiveDeps; socket: { send(t: string): void; close(): void }; publisher: Publisher } {
  const seen: Seen = { closed: 0, stopped: 0, sent: [], enders: [], tracked: 0, timers: 0 };
  const publisher: Publisher = {
    connected: () => undefined,
    disconnected: () => undefined,
    joined: () => undefined,
    queue: () => undefined,
    command: () => undefined,
    tick: () => undefined,
    last: () => true,
    stop: () => void (seen.stopped += 1),
  };
  const deps: EndLiveDeps = {
    ender: (at, token) => {
      seen.enders.push({ at, token });
      return Promise.resolve();
    },
    track: () => void (seen.tracked += 1),
    farewells: new Map<number, Farewell>(),
    setTimer: () => void (seen.timers += 1),
    clearTimer: () => undefined,
  };
  return { seen, deps, socket: { send: (t) => void seen.sent.push(t), close: () => void (seen.closed += 1) }, publisher };
}

test("no backend address: the connection is closed and the publisher stopped, and nothing is dialled", () => {
  const { seen, deps, socket, publisher } = parts();
  endLive(deps, { at: null, socket, publisher, n: 3, token: HOST_TOKEN });
  assert.equal(seen.closed, 1);
  assert.equal(seen.stopped, 1);
  assert.deepEqual(seen.enders, []);
  assert.equal(seen.tracked, 0);
  assert.deepEqual(seen.sent, []);
  assert.equal(deps.farewells.size, 0);
});

test("no connection or no publisher: what is there is closed or stopped, and the session ended on its own backend", () => {
  for (const which of ["socket", "publisher"] as const) {
    const { seen, deps, socket, publisher } = parts();
    endLive(deps, { at: ORIGIN, socket: which === "socket" ? null : socket, publisher: which === "publisher" ? null : publisher, n: 3, token: HOST_TOKEN });
    assert.equal(seen.closed, which === "socket" ? 0 : 1, which);
    assert.equal(seen.stopped, which === "publisher" ? 0 : 1, which);
    assert.deepEqual(seen.enders, [{ at: ORIGIN, token: HOST_TOKEN }], which);
    assert.equal(seen.tracked, 1, which);
    assert.equal(deps.farewells.size, 0, which);
  }
});

test("both there: the farewell is registered for the connection and tracked, and nothing is ended elsewhere yet", () => {
  const { seen, deps, socket, publisher } = parts();
  endLive(deps, { at: ORIGIN, socket, publisher, n: 3, token: HOST_TOKEN });
  assert.deepEqual([...deps.farewells.keys()], [3]);
  assert.equal(seen.tracked, 1);
  assert.equal(seen.closed, 0);
  assert.deepEqual(seen.enders, []);
});

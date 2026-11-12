// The pure pairing state machine (core/pairing/machine.ts): every poll answer, the timing rules
// (never faster than the server allows, slow_down adds 5 s, a poll at a time), unpair, the check
// at startup, and stale answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL, POLL_MARGIN_MS, step } from "../../src/core/pairing/machine.ts";
import type { Effect, PairingEvent, PairingState } from "../../src/core/pairing/machine.ts";
import type { PollAnswer } from "../../src/core/pairing/protocol.ts";
import { pairingView } from "../../src/core/pairing/view.ts";
import { newToken, ORIGIN, PAGE, USER_CODE } from "./pairing-tokens.ts";

const OK_ORIGIN = { ok: true, origin: ORIGIN } as const;
const DEVICE_CODE = newToken("dc");

function run(events: [PairingEvent, number][], from: PairingState = INITIAL): { state: PairingState; effects: Effect[][] } {
  let state = from;
  const effects: Effect[][] = [];
  for (const [e, now] of events) {
    const out = step(state, e, now);
    state = out.state;
    effects.push([...out.effects]);
  }
  return { state, effects };
}

const startEvent: PairingEvent = { type: "start", origin: OK_ORIGIN, keychain: true };
const started = (attempt = 1, intervalMs = 5000, expiresInMs = 600_000): PairingEvent => ({
  type: "started",
  attempt,
  answer: { kind: "started", deviceCode: DEVICE_CODE, userCode: USER_CODE, page: PAGE, expiresInMs, intervalMs },
});
/** Started at t=0 and waiting for the first poll. */
const waitingAt0 = (): PairingState => run([[startEvent, 0], [started(), 0]]).state;
const polledWith = (answer: PollAnswer): PairingEvent => ({ type: "polled", attempt: 1, answer });

test("start asks the server, then shows the code, opens the page and waits a full interval and a margin", () => {
  const r = run([[startEvent, 0], [started(), 100]]);
  assert.deepEqual(r.effects[0], [{ do: "start", attempt: 1, origin: ORIGIN }]);
  assert.deepEqual(r.effects[1], [{ do: "open_page", page: PAGE }, { do: "wake", attempt: 1, at: 100 + 5000 + POLL_MARGIN_MS }]);
  assert.deepEqual(pairingView(r.state, 100), { state: "waiting", userCode: USER_CODE, page: PAGE, secondsLeft: 600 });
});

test("no server address, or no keychain: refused before anything is sent", () => {
  for (const [e, message] of [
    [{ type: "start", origin: { ok: false, reason: "unset" }, keychain: true }, /no server address/],
    [{ type: "start", origin: OK_ORIGIN, keychain: false }, /no system keychain/],
  ] as const) {
    const r = run([[e, 0]]);
    assert.deepEqual(r.effects, [[]]);
    const v = pairingView(r.state, 0);
    assert.equal(v.state, "unpaired");
    assert.match(v.state === "unpaired" ? (v.message ?? "") : "", message);
  }
});

test("a start the server refuses or does not answer ends with a message", () => {
  for (const [kind, notice] of [["too_many", "too_many"], ["unreachable", "unreachable"], ["unexpected", "unexpected"]] as const) {
    const r = run([[startEvent, 0], [{ type: "started", attempt: 1, answer: { kind } }, 0]]);
    assert.deepEqual(r.state, { kind: "unpaired", attempt: 1, notice });
  }
});

test("poll_due sends one poll; a second poll_due while it is out sends nothing", () => {
  const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [{ type: "poll_due", attempt: 1 }, 5600]], waitingAt0());
  assert.deepEqual(r.effects, [[{ do: "poll", attempt: 1, origin: ORIGIN, deviceCode: DEVICE_CODE }], []]);
});

test("authorization_pending waits the same interval again, counted from the answer", () => {
  const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [polledWith({ kind: "authorization_pending" }), 5800]], waitingAt0());
  assert.deepEqual(r.effects[1], [{ do: "wake", attempt: 1, at: 5800 + 5000 + POLL_MARGIN_MS }]);
});

test("slow_down adds 5 s to the interval, for this and every later poll", () => {
  const r = run(
    [
      [{ type: "poll_due", attempt: 1 }, 5500],
      [polledWith({ kind: "slow_down" }), 5500],
      [{ type: "poll_due", attempt: 1 }, 16_000],
      [polledWith({ kind: "authorization_pending" }), 16_000],
    ],
    waitingAt0(),
  );
  assert.deepEqual(r.effects[1], [{ do: "wake", attempt: 1, at: 5500 + 10_000 + POLL_MARGIN_MS }]);
  assert.deepEqual(r.effects[3], [{ do: "wake", attempt: 1, at: 16_000 + 10_000 + POLL_MARGIN_MS }]);
});

test("a lost answer or a server fault waits at least the interval, longer if Retry-After says so", () => {
  for (const [afterMs, wait] of [[null, 5000], [1000, 5000], [30_000, 30_000], [10_000_000, 60_000]] as const) {
    const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [polledWith({ kind: "retry", afterMs }), 6000]], waitingAt0());
    assert.deepEqual(r.effects[1], [{ do: "wake", attempt: 1, at: 6000 + wait + POLL_MARGIN_MS }], `after ${afterMs}`);
  }
});

test("access_denied, expired_token and an unexpected answer end the pairing, and no poll follows", () => {
  for (const [kind, notice] of [["access_denied", "denied"], ["expired_token", "code_expired"], ["unexpected", "unexpected"]] as const) {
    const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [polledWith({ kind }), 5600], [{ type: "poll_due", attempt: 1 }, 20_000]], waitingAt0());
    assert.deepEqual(r.state, { kind: "unpaired", attempt: 1, notice });
    assert.deepEqual(r.effects.slice(1), [[], []]);
  }
});

test("the token: saved with the server and the email, and shown as paired with that email only", () => {
  const token = newToken("dev");
  const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [polledWith({ kind: "ok", token, email: "ann@example.test" }), 5600], [{ type: "saved", attempt: 1, ok: true }, 5600]], waitingAt0());
  const record = { origin: ORIGIN, token, email: "ann@example.test" };
  assert.deepEqual(r.effects[1], [{ do: "save", attempt: 1, record }]);
  assert.deepEqual(r.effects[2], []);
  assert.deepEqual(pairingView(r.state, 5600), { state: "paired", email: "ann@example.test", deviceName: null, pairAgain: false });
});

test("a token that cannot be saved is given back to the server and the user is told", () => {
  const token = newToken("dev");
  const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [polledWith({ kind: "ok", token, email: "a@example.test" }), 5600], [{ type: "saved", attempt: 1, ok: false }, 5600]], waitingAt0());
  assert.deepEqual(r.effects[2], [{ do: "revoke", record: { origin: ORIGIN, token, email: "a@example.test" } }]);
  assert.deepEqual(r.state, { kind: "unpaired", attempt: 1, notice: "save_failed" });
});

test("the wait ends at the pairing's end: the last wake is at expiry, and then no poll is sent", () => {
  const w = run([[startEvent, 0], [started(1, 5000, 8000), 0]]);
  assert.deepEqual(w.effects[1][1], { do: "wake", attempt: 1, at: 5500 });
  const r = run([[{ type: "poll_due", attempt: 1 }, 5500], [polledWith({ kind: "authorization_pending" }), 5600], [{ type: "poll_due", attempt: 1 }, 8000]], w.state);
  assert.deepEqual(r.effects[1], [{ do: "wake", attempt: 1, at: 8000 }]);
  assert.deepEqual(r.effects[2], []);
  assert.deepEqual(r.state, { kind: "unpaired", attempt: 1, notice: "code_expired" });
});

test("cancel while waiting: back to unpaired, and the old attempt's answers and wakes are ignored", () => {
  const r = run(
    [
      [{ type: "poll_due", attempt: 1 }, 5500],
      [{ type: "unpair" }, 5600],
      [polledWith({ kind: "ok", token: newToken("dev"), email: "a@example.test" }), 5700],
      [{ type: "poll_due", attempt: 1 }, 11_000],
    ],
    waitingAt0(),
  );
  assert.deepEqual(r.state, { kind: "unpaired", attempt: 2, notice: null });
  assert.deepEqual(r.effects.slice(1), [[], [], []]);
});

test("a second start while one runs, or while paired, does nothing", () => {
  assert.deepEqual(run([[startEvent, 1]], waitingAt0()).effects, [[]]);
  const paired: PairingState = { kind: "paired", attempt: 1, record: { origin: ORIGIN, token: newToken("dev"), email: "a@example.test" }, deviceName: null, expired: false };
  assert.deepEqual(run([[startEvent, 1]], paired).effects, [[]]);
});

test("unpair: the token is deleted here first, then given back to the server", () => {
  const record = { origin: ORIGIN, token: newToken("dev"), email: "a@example.test" };
  const r = run([[{ type: "unpair" }, 0]], { kind: "paired", attempt: 3, record, deviceName: "Studio", expired: false });
  assert.deepEqual(r.effects, [[{ do: "forget" }, { do: "revoke", record }]]);
  assert.deepEqual(r.state, { kind: "unpaired", attempt: 4, notice: "unpaired" });
});

test("startup: a saved pairing is checked with its own server; the answer sets the name, or ends it", () => {
  const record = { origin: ORIGIN, token: newToken("dev"), email: "a@example.test" };
  const loaded = run([[{ type: "loaded", record }, 0]]);
  assert.deepEqual(loaded.effects, [[{ do: "check", attempt: 1, record }]]);
  const named = run([[{ type: "checked", attempt: 1, answer: { kind: "ok", name: "Studio" } }, 1]], loaded.state);
  assert.deepEqual(pairingView(named.state, 1), { state: "paired", email: "a@example.test", deviceName: "Studio", pairAgain: false });
  const gone = run([[{ type: "checked", attempt: 1, answer: { kind: "gone" } }, 1]], loaded.state);
  assert.deepEqual(gone.effects, [[{ do: "forget" }]]);
  assert.deepEqual(gone.state, { kind: "unpaired", attempt: 2, notice: "revoked_on_site" });
  // A network error or a server fault keeps the pairing as it is.
  assert.deepEqual(run([[{ type: "checked", attempt: 1, answer: { kind: "unknown" } }, 1]], loaded.state), { state: loaded.state, effects: [[]] });
});

test("an expired token keeps the pairing, shows 'pair again', and a new pairing may start", () => {
  const record = { origin: ORIGIN, token: newToken("dev"), email: "a@example.test" };
  const loaded = run([[{ type: "loaded", record }, 0], [{ type: "checked", attempt: 1, answer: { kind: "expired" } }, 1]]);
  assert.deepEqual(loaded.effects[1], []);
  assert.deepEqual(pairingView(loaded.state, 1), { state: "paired", email: "a@example.test", deviceName: null, pairAgain: true });
  assert.deepEqual(run([[startEvent, 2]], loaded.state).effects, [[{ do: "start", attempt: 2, origin: ORIGIN }]]);
});

test("the view never carries the device code or the token, in any state", () => {
  const token = newToken("dev");
  const states: PairingState[] = [
    INITIAL,
    run([[startEvent, 0]]).state,
    waitingAt0(),
    { kind: "paired", attempt: 1, record: { origin: ORIGIN, token, email: "a@example.test" }, deviceName: "x", expired: false },
    { kind: "paired", attempt: 1, record: { origin: ORIGIN, token, email: "a@example.test" }, deviceName: null, expired: true },
  ];
  for (const s of states) {
    const text = JSON.stringify(pairingView(s, 0));
    assert.ok(!text.includes(DEVICE_CODE) && !text.includes(token) && !text.includes("cbp_"), text);
  }
});

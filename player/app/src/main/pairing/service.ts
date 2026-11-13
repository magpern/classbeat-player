// Runs the pairing state machine (core/pairing/machine.ts): carries out its effects with the
// backend, the keychain, the browser and one timer, and feeds the answers back in. The device code
// and the token never leave this module except in a request to the server that issued them, and
// in the keychain. Nothing here logs.
import { INITIAL, step } from "../../core/pairing/machine.ts";
import type { Effect, PairingEvent, PairingState } from "../../core/pairing/machine.ts";
import type { OriginResult } from "../../core/pairing/origin.ts";
import { parseDeviceAnswer, parsePollAnswer, parseStartAnswer } from "../../core/pairing/protocol.ts";
import type { HttpAnswer } from "../../core/pairing/protocol.ts";
import { parseRecord, recordText } from "../../core/pairing/record.ts";
import type { PairingRecord } from "../../core/pairing/record.ts";
import { pairingView } from "../../core/pairing/view.ts";
import type { PairingView } from "../../core/pairing/view.ts";
import type { BackendCall, BackendRequest } from "./http.ts";
import type { SecretStore } from "./keychain.ts";

export interface PairingDeps {
  readonly now: () => number;
  readonly call: BackendCall;
  readonly store: SecretStore;
  readonly openPage: (url: string) => void;
  /** The backend's address setting, read when pairing starts. */
  readonly origin: () => OriginResult;
  readonly allowLoopbackHttp: boolean;
  readonly platform: string;
  readonly version: string;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface PairingService {
  view(): PairingView;
  start(): PairingView;
  unpair(): PairingView;
  /** Reads a saved pairing, once, at startup, and asks the server whether it still works. */
  load(): void;
  stop(): void;
  /** Main process only (class sync): the saved pairing and whether the server said it ran out; null when not paired. */
  credential(): { readonly record: PairingRecord; readonly expired: boolean } | null;
  /** What the player API answered to the token: taken as the startup check's answer would be. */
  tokenRefused(kind: "gone" | "expired"): void;
  /** Called once the pairing is saved in the keychain ("paired") or deleted from it ("forgotten"). */
  watch(listener: (change: "paired" | "forgotten") => void): void;
  /** Whether the keychain could hold a pairing now. */
  keychainAvailable(): boolean;
}

export function createPairingService(d: PairingDeps): PairingService {
  let state: PairingState = INITIAL;
  let timer: unknown = null;
  let stopped = false;
  const queue: PairingEvent[] = [];
  let running = false;
  const listeners: ((change: "paired" | "forgotten") => void)[] = [];
  const notify = (change: "paired" | "forgotten"): void => {
    for (const l of listeners) {
      try {
        l(change);
      } catch {
        // A listener's failure changes nothing about the pairing.
      }
    }
  };

  const cancelTimer = (): void => {
    if (timer !== null) d.clearTimer(timer);
    timer = null;
  };
  const ask = (req: BackendRequest, then: (a: HttpAnswer) => PairingEvent | null): void => {
    void d
      .call(req)
      .catch((): HttpAnswer => ({ kind: "unreachable" }))
      .then((a) => {
        const e = then(a);
        if (e !== null) dispatch(e);
      });
  };

  function run(e: Effect): void {
    switch (e.do) {
      case "start":
        return ask({ origin: e.origin, method: "POST", path: "/api/pairing/start", body: { platform: d.platform, version: d.version } }, (a) => ({
          type: "started",
          attempt: e.attempt,
          answer: parseStartAnswer(a, e.origin),
        }));
      case "open_page":
        try {
          d.openPage(e.page);
        } catch {
          // The page is also shown in the window, to be opened by hand.
        }
        return;
      case "wake":
        cancelTimer();
        timer = d.setTimer(() => {
          timer = null;
          dispatch({ type: "poll_due", attempt: e.attempt });
        }, Math.max(0, e.at - d.now()));
        return;
      case "poll":
        return ask({ origin: e.origin, method: "POST", path: "/api/pairing/token", body: { device_code: e.deviceCode } }, (a) => ({
          type: "polled",
          attempt: e.attempt,
          origin: e.origin,
          answer: parsePollAnswer(a),
        }));
      case "save": {
        let ok = true;
        try {
          d.store.save(recordText(e.record));
        } catch {
          ok = false;
        }
        if (ok) notify("paired");
        return dispatch({ type: "saved", attempt: e.attempt, ok });
      }
      case "check":
        return ask({ origin: e.record.origin, method: "GET", path: "/api/player/device", token: e.record.token }, (a) => ({
          type: "checked",
          attempt: e.attempt,
          answer: parseDeviceAnswer(a),
        }));
      case "forget":
        try {
          d.store.clear();
        } catch {
          // Nothing more can be done; the state no longer holds the token either way.
        }
        return notify("forgotten");
      case "revoke":
        // Sent after the local copy is gone, and its answer changes nothing here: offline or not, this
        // computer is unpaired. A token never given back is deleted on the server 24 hours after
        // pairing if it was never used (ADR 0002), or after 180 days without use if it was.
        return ask({ origin: e.record.origin, method: "DELETE", path: "/api/player/device", token: e.record.token }, () => null);
    }
  }

  function dispatch(e: PairingEvent): void {
    if (stopped) return;
    queue.push(e);
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const before = state;
        const out = step(state, next, d.now());
        state = out.state;
        // Leaving the wait for good: no poll is left behind.
        if (before.kind === "waiting" && state.kind !== "waiting") cancelTimer();
        for (const effect of out.effects) run(effect);
      }
    } finally {
      running = false;
    }
  }

  const view = (): PairingView => pairingView(state, d.now());
  return {
    view,
    start() {
      dispatch({ type: "start", origin: d.origin(), keychain: d.store.available() });
      return view();
    },
    unpair() {
      dispatch({ type: "unpair" });
      return view();
    },
    load() {
      const text = d.store.load();
      const record = text === null ? null : parseRecord(text, d.allowLoopbackHttp);
      if (text !== null && record === null) run({ do: "forget" });
      dispatch({ type: "loaded", record });
    },
    stop() {
      stopped = true;
      cancelTimer();
    },
    credential() {
      return state.kind === "paired" ? { record: state.record, expired: state.expired } : null;
    },
    tokenRefused(kind) {
      if (state.kind === "paired") dispatch({ type: "checked", attempt: state.attempt, answer: { kind } });
    },
    watch(listener) {
      listeners.push(listener);
    },
    keychainAvailable() {
      try {
        return d.store.available();
      } catch {
        return false;
      }
    },
  };
}

// Runs the host's live session (core/live/session-model.ts) in the main process: the start request
// with the device token, the one WebSocket, the reconnect timer and the class run's publisher.
// The host token stays in this process's memory, in the model, and leaves it only in `hello` (on
// the host's connection, or on the ender's when a session the host is not in is ended: ender.ts);
// it is never stored, logged or sent to a window. The presenter gets `view()` and nothing else.
import { parseHostFrame, parseStartAnswer, liveSocketUrl } from "../../core/live/host-wire.ts";
import type { Slot } from "../../core/live/host-wire.ts";
import { livePanelView } from "../../core/live/panel-view.ts";
import type { LivePanelView } from "../../core/live/panel-view.ts";
import { step } from "../../core/live/session-model.ts";
import { OFF } from "../../core/live/session-types.ts";
import type { Credential, LiveEffect, LiveEvent, LiveModel } from "../../core/live/session-types.ts";
import type { BackendCall } from "../pairing/http.ts";
import { endSession } from "./ender.ts";
import type { Connect, LiveSocket, SocketEvents } from "./live-socket.ts";
import { createPublisher } from "./publisher.ts";
import type { LiveHost, Publisher } from "./publisher.ts";

export interface LiveCredential {
  readonly origin: string;
  readonly token: string;
  readonly expired: boolean;
}

export interface LiveDeps {
  /** Monotonic milliseconds, the class clock's own. */
  readonly now: () => number;
  /** 16 random bytes in base64url: a new class run's id. */
  readonly runId: () => string;
  readonly credential: () => LiveCredential | null;
  readonly call: BackendCall;
  readonly connect: Connect;
  readonly host: LiveHost;
  readonly classOpen: () => boolean;
  /** Whether a second display shows the room, so the presenter is not seen by the room. */
  readonly secondDisplay: () => boolean;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface LiveService {
  view(): LivePanelView;
  start(): LivePanelView;
  end(): LivePanelView;
  makeCode(): LivePanelView;
  drop(slot: Slot): LivePanelView;
  /** Another class opened, or the class closed: the run's session ends. */
  classChanged(): void;
  /** The class may have changed: called with every snapshot. */
  tick(): void;
  /** The app quits or the presenter closed: ends the session. */
  stop(): void;
}

export function createLiveService(d: LiveDeps): LiveService {
  let model: LiveModel = OFF;
  let origin: string | null = null;
  let socket: LiveSocket | null = null;
  let publisher: Publisher | null = null;
  let retry: unknown = null;

  /** Every connection, the host's and the ender's, goes to the live socket of the session's backend. */
  const dial = (at: string, on: SocketEvents): LiveSocket => d.connect(liveSocketUrl(at), on);
  const cancelRetry = (): void => {
    if (retry !== null) d.clearTimer(retry);
    retry = null;
  };
  const dropPublisher = (): void => {
    publisher?.stop();
    publisher = null;
  };

  /** `at`: the backend a start answer came from, which a late answer's session is ended on. */
  const dispatch = (e: LiveEvent, at: string | null = origin): void => {
    const before = model;
    const out = step(model, e, d.now());
    model = out.model;
    // Effects first: an `end` goes out through the ending run's publisher before it is dropped.
    for (const effect of out.effects) run(effect, at);
    if (before.run !== model.run) {
      dropPublisher();
      if (model.run !== null) publisher = createPublisher({ run: model.run, host: d.host, setTimer: d.setTimer, clearTimer: d.clearTimer, applied: (slot, action, deltaMs) => dispatch({ type: "applied", slot, action, deltaMs }) });
    }
    if (model.phase === "idle" || model.phase === "ended" || model.phase === "refused") origin = null;
  };

  const run = (x: LiveEffect, at: string | null): void => {
    switch (x.kind) {
      case "post_session": {
        const { request } = x;
        const c = d.credential();
        if (c === null) return dispatch({ type: "answer", request, answer: { ok: false, refusal: "pair_again" } });
        origin = c.origin;
        void d
          .call({ origin: c.origin, method: "POST", path: "/api/live/sessions", token: c.token })
          .catch(() => ({ kind: "unreachable" }) as const)
          .then((a) => dispatch({ type: "answer", request, answer: parseStartAnswer(a) }, c.origin));
        return;
      }
      case "end_session": {
        // Only to the backend the session was started on, never to another address.
        if (at === null) return;
        endSession({ open: (on) => dial(at, on), setTimer: d.setTimer, clearTimer: d.clearTimer }, x.token);
        return;
      }
      case "connect": {
        if (origin === null) return;
        const n = x.socket;
        socket = dial(origin, {
          open: () => dispatch({ type: "open", socket: n }),
          message: (text) => onFrame(n, text),
          closed: (code) => {
            if (model.socket === n) publisher?.disconnected();
            dispatch({ type: "closed", socket: n, code });
          },
        });
        return;
      }
      case "hello":
        if (model.socket === x.socket) socket?.send(JSON.stringify({ v: 1, type: "hello", token: x.token }));
        return;
      case "welcomed": {
        const s = socket;
        if (s !== null) publisher?.connected((text) => s.send(text));
        return;
      }
      case "joined":
        publisher?.joined();
        return;
      case "send":
        publisher?.queue(x.message);
        return;
      case "close":
        publisher?.disconnected();
        socket?.close();
        socket = null;
        return;
      case "retry_in":
        cancelRetry();
        socket = null;
        retry = d.setTimer(() => {
          retry = null;
          dispatch({ type: "retry" });
        }, x.ms);
        return;
      case "cancel_retry":
        cancelRetry();
        return;
    }
  };

  const onFrame = (n: number, text: string): void => {
    if (model.socket !== n) return;
    const message = parseHostFrame(text);
    if (message === null) return;
    // A command is the publisher's (the intake), only while the host is in.
    if (message.type === "command") return model.phase === "live" ? publisher?.command(message.raw) : undefined;
    dispatch({ type: "message", socket: n, message });
  };

  const credential = (): Credential => {
    const c = d.credential();
    return c === null ? "none" : c.expired ? "expired" : "ok";
  };
  const view = (): LivePanelView => livePanelView(model, { now: d.now(), classOpen: d.classOpen(), secondDisplay: d.secondDisplay(), origin });

  return {
    view,
    start() {
      dispatch({ type: "start", run: d.runId(), credential: credential(), classOpen: d.classOpen() });
      return view();
    },
    end() {
      dispatch({ type: "end" });
      return view();
    },
    makeCode() {
      dispatch({ type: "make_code", secondDisplay: d.secondDisplay() });
      return view();
    },
    drop(slot) {
      dispatch({ type: "drop", slot });
      return view();
    },
    classChanged() {
      dispatch({ type: "class_changed" });
    },
    tick() {
      if (model.phase === "live") publisher?.tick();
    },
    stop() {
      dispatch({ type: "end" });
      dropPublisher();
      cancelRetry();
    },
  };
}

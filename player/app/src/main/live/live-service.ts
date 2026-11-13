// Runs the host's live session (core/live/session-model.ts) in the main process: the start request
// with the device token, the one WebSocket, the reconnect timer and the class run's publisher.
// The host token stays in this process's memory, in the model, and leaves it only in `hello` (on
// the host's connection, or on the ender's when a session the host is not in is ended: ender.ts);
// it is never stored, logged or sent to a window. The presenter gets `view()`; the room window gets
// `roomView()`, the phone remote's slot (core/live/room-slot.ts), and nothing else.
// Ending while live keeps the host's connection until the session is ended (end-live.ts, farewell.ts, #211).
import { parseHostFrame, parseStartAnswer, liveSocketUrl } from "../../core/live/host-wire.ts";
import type { Slot } from "../../core/live/host-wire.ts";
import { livePanelView } from "../../core/live/panel-view.ts";
import type { LivePanelView } from "../../core/live/panel-view.ts";
import { roomSlotOf } from "../../core/live/room-slot.ts";
import type { RemoteView } from "../../core/room/remote.ts";
import { step } from "../../core/live/session-model.ts";
import { OFF } from "../../core/live/session-types.ts";
import type { Credential, LiveEffect, LiveEvent, LiveModel } from "../../core/live/session-types.ts";
import type { BackendCall } from "../pairing/http.ts";
import { endSession } from "./ender.ts";
import { endLive } from "./end-live.ts";
import { failedLine, listenerLine } from "./log-lines.ts";
export { failedLine };
import type { Farewell } from "./farewell.ts";
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
  /** Where a failed step is written: one fixed line and the error's kind, never its text. Default console.warn. */
  readonly log?: (line: string) => void;
}

export interface LiveService {
  view(): LivePanelView;
  /** The room window's slot: the join code and the phones connected, never anything else of the session. */
  roomView(): RemoteView;
  /** Calls the listener after every event that changed the session. */
  onChange(listener: () => void): void;
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
  /** Whether a start answer is awaited, an `end` on the host's connection is not yet answered or an
   * ender still runs: a session may be left to end (#205, #211). */
  busy(): boolean;
  /** Resolves once none of those is left. Never rejects. */
  settled(): Promise<void>;
}

export function createLiveService(d: LiveDeps): LiveService {
  let model: LiveModel = OFF;
  let origin: string | null = null;
  let socket: LiveSocket | null = null;
  let publisher: Publisher | null = null;
  let retry: unknown = null;
  const listeners: (() => void)[] = [];
  const log = d.log ?? ((line: string) => console.warn(line));
  // The start requests awaiting their answer, the farewells and the enders still running, for the
  // quit (#205). A step that throws is logged without its text, which could hold a token.
  const inFlight = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>): void => {
    const done = (): void => void inFlight.delete(p);
    inFlight.add(p);
    p.then(done, (e: unknown) => {
      done();
      log(failedLine(e));
    });
  };
  // The host connections that ended their session and wait for its answer, by connection number.
  const farewells = new Map<number, Farewell>();

  /** Every connection, the host's and the ender's, goes to the live socket of the session's backend. */
  const dial = (at: string, on: SocketEvents): LiveSocket => d.connect(liveSocketUrl(at), on);
  const ender = (at: string, token: string): Promise<void> => endSession({ open: (on) => dial(at, on), setTimer: d.setTimer, clearTimer: d.clearTimer }, token);
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
    // A listener that throws never reaches the socket callback, start() or the stop at quit.
    if (model !== before)
      for (const l of listeners) {
        try {
          l();
        } catch (err) {
          log(listenerLine(err));
        }
      }
  };

  const run = (x: LiveEffect, at: string | null): void => {
    switch (x.kind) {
      case "post_session": {
        const { request } = x;
        const c = d.credential();
        if (c === null) return dispatch({ type: "answer", request, answer: { ok: false, refusal: "pair_again" } });
        origin = c.origin;
        track(
          d
            .call({ origin: c.origin, method: "POST", path: "/api/live/sessions", token: c.token })
            .catch(() => ({ kind: "unreachable" }) as const)
            .then((a) => dispatch({ type: "answer", request, answer: parseStartAnswer(a) }, c.origin)),
        );
        return;
      }
      case "end_session": {
        // Only to the backend the session was started on, never to another address.
        if (at === null) return;
        track(ender(at, x.token));
        return;
      }
      case "end_live": {
        // The run's connection and publisher are the ending's now (end-live.ts): nothing else uses them.
        const ending = { at, socket, publisher, n: x.socket, token: x.token };
        socket = null;
        publisher = null;
        endLive({ ender, track, farewells, setTimer: d.setTimer, clearTimer: d.clearTimer }, ending);
        return;
      }
      case "connect": {
        if (origin === null) return;
        const n = x.socket;
        socket = dial(origin, {
          open: () => dispatch({ type: "open", socket: n }),
          message: (text) => {
            const f = farewells.get(n);
            if (f !== undefined) f.message(text);
            else onFrame(n, text);
          },
          closed: (code) => {
            const f = farewells.get(n);
            if (f !== undefined) return f.closed(code);
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
    roomView: () => roomSlotOf(model, { paired: d.credential() !== null, classOpen: d.classOpen(), site: origin }),
    onChange(listener) {
      listeners.push(listener);
    },
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
    busy: () => inFlight.size > 0,
    async settled() {
      // An answer that comes while waiting may start an ender: it is tracked before the answer's own promise settles.
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}

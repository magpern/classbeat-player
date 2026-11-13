// The host's live session (ADR 0005 sections 2, 3 and 6): starting it, its connection with the
// reconnect back-off, the phones' places, the control code and its ending. Pure: `step` takes an
// event at monotonic time `now` and says what to do; the main process carries the effects out
// (main/live/live-service.ts). Nothing here can stop or change the class: the clock, the music
// link and the room screen run without it, and a drop only takes the phone away.
//
// - Started only on the instructor's request, while a class is open, by a paired app. Off at each
//   start of the app. The class run ending (another class opened, the window closed) ends it.
// - The host token lives in this state, in the main process's memory, and leaves it only in the
//   `hello` and `end_session` effects, each of which puts it in a `hello`. The presenter's view
//   (panel-view.ts) never holds it.
// - A session the host is not in is still ended on the backend (#203): End, the app quitting or
//   another class while starting, connecting or reconnecting, and a late start answer for a run
//   that is no longer waiting for it, each give `end_session`. None leaves it for 15 minutes.
// - A connection lost is tried again after 1, 2, 4, 8 and then every 15 s, for the 15 minutes the
//   live process keeps the session. A `hello` refused on reconnect (4401: the live process
//   restarted), the session ended (4403) or a newer connection with the token (4409) end it here.
// - The control code is offered only with a second display, and is only ever in this state and the
//   presenter's view. A `drop` frees a phone's place and ends the shown code (ADR 0005 section 3).
import type { HostInbound, Slot } from "./host-wire.ts";
import { OFF } from "./session-types.ts";
import type { EndReason, LiveEffect, LiveEvent, LiveModel, Place, Refusal, Step } from "./session-types.ts";

export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 15_000];
/** How long the live process keeps a session after the host's connection is lost. */
export const KEEP_MS = 15 * 60_000;
/** How long the presenter shows "Phone 1: pause" after a phone's command was applied. */
export const LINE_MS = 5000;

/** WebSocket close codes of the live process (backend live_wire_policy.py). */
export const CLOSE_HELLO_REFUSED = 4401;
export const CLOSE_ENDED = 4403;
export const CLOSE_REPLACED = 4409;

const same = (model: LiveModel): Step => ({ model, effects: [] });
const isRunning = (m: LiveModel): boolean => m.phase === "connecting" || m.phase === "live" || m.phase === "reconnecting";

/** The state at rest, keeping the request and connection counters so a late event is never taken. */
const rest = (m: LiveModel, over: Partial<LiveModel>): LiveModel => ({ ...OFF, sockets: m.sockets, requests: m.requests, ...over });

/** Ends the session here: the token is forgotten, the connection closed, no retry left. */
function finish(m: LiveModel, reason: EndReason, extra: readonly LiveEffect[] = []): Step {
  const effects: LiveEffect[] = [...extra];
  if (m.socket !== 0) effects.push({ kind: "close", socket: m.socket });
  if (m.phase === "reconnecting") effects.push({ kind: "cancel_retry" });
  return { model: rest(m, { phase: "ended", ended: reason }), effects };
}

/**
 * The instructor ends it, the app quits or the class run ends. Live, `end` goes over the host's
 * connection; connecting or reconnecting, over one of its own (`end_session`). While starting
 * there is no session yet: the answer, when it comes, is ended (`answer` below).
 */
function endHere(m: LiveModel, reason: EndReason): Step {
  if (m.phase === "starting") return same(rest(m, { phase: "ended", ended: reason }));
  if (!isRunning(m)) return same(m);
  if (m.phase === "live") return finish(m, reason, [{ kind: "send", message: { v: 1, type: "end" } }]);
  return finish(m, reason, m.session === null ? [] : [{ kind: "end_session", token: m.session.hostToken }]);
}

function connect(m: LiveModel): Step {
  const socket = m.sockets + 1;
  return { model: { ...m, socket, sockets: socket }, effects: [{ kind: "connect", socket }] };
}

function lost(m: LiveModel, code: number, now: number): Step {
  if (code === CLOSE_HELLO_REFUSED) return finish({ ...m, socket: 0 }, "gone");
  if (code === CLOSE_ENDED) return finish({ ...m, socket: 0 }, "expired");
  if (code === CLOSE_REPLACED) return finish({ ...m, socket: 0 }, "replaced");
  const lostAt = m.lostAt ?? now;
  const ms = BACKOFF_MS[Math.min(m.attempt, BACKOFF_MS.length - 1)];
  if (now + ms - lostAt > KEEP_MS) return finish({ ...m, socket: 0 }, "lost");
  // While the host is away no phone is connected through it; the places stay held.
  const places = m.places.map((p) => (p === "connected" ? "away" : p)) as [Place, Place];
  return { model: { ...m, phase: "reconnecting", socket: 0, lostAt, attempt: m.attempt + 1, places }, effects: [{ kind: "retry_in", ms }] };
}

function setPlace(m: LiveModel, slot: Slot, p: Place): readonly [Place, Place] {
  return slot === 1 ? [p, m.places[1]] : [m.places[0], p];
}

function onMessage(m: LiveModel, msg: HostInbound, now: number): Step {
  switch (msg.type) {
    case "welcome": {
      const places = m.places.map((p) => (p === "connected" ? "away" : p)) as [Place, Place];
      return { model: { ...m, phase: "live", attempt: 0, lostAt: null, places }, effects: [{ kind: "welcomed", socket: m.socket }] };
    }
    case "controller_joined":
      return { model: { ...m, places: setPlace(m, msg.slot, "connected") }, effects: [{ kind: "joined" }] };
    case "controller_left":
      return same(m.places[msg.slot - 1] === "connected" ? { ...m, places: setPlace(m, msg.slot, "away") } : m);
    case "control_code":
      return same({ ...m, code: { code: msg.code, expiresAt: now + msg.expiresInMs }, codeNote: null });
    case "code_cancelled":
      return same({ ...m, code: null, codeNote: msg.reason === "replaced" ? m.codeNote : msg.reason });
    case "ended":
      return finish(m, msg.reason === "host_ended" ? "host_ended" : msg.reason === "revoked" ? "revoked" : "expired");
    case "command":
      // Commands go to the command intake (intake.ts), never through here.
      return same(m);
  }
}

export function step(m: LiveModel, e: LiveEvent, now: number): Step {
  switch (e.type) {
    case "start": {
      if (m.phase === "starting" || isRunning(m)) return same(m);
      const refusal: Refusal | null = !e.classOpen ? "no_class" : e.credential === "none" ? "not_paired" : e.credential === "expired" ? "pair_again" : null;
      if (refusal !== null) return same(rest(m, { phase: "refused", refusal }));
      const request = m.requests + 1;
      return { model: rest(m, { phase: "starting", run: e.run, request, requests: request }), effects: [{ kind: "post_session", request }] };
    }
    case "answer": {
      // A late answer (ended, the class changed, or a newer start since): its session is ended.
      if (m.phase !== "starting" || e.request !== m.request) return { model: m, effects: e.answer.ok ? [{ kind: "end_session", token: e.answer.session.hostToken }] : [] };
      if (!e.answer.ok) return same(rest(m, { phase: "refused", refusal: e.answer.refusal }));
      return connect({ ...m, phase: "connecting", session: e.answer.session });
    }
    case "open":
      if (e.socket !== m.socket || m.session === null) return same(m);
      return { model: m, effects: [{ kind: "hello", socket: e.socket, token: m.session.hostToken }] };
    case "message":
      return e.socket === m.socket && isRunning(m) ? onMessage(m, e.message, now) : same(m);
    case "closed":
      return e.socket === m.socket && isRunning(m) ? lost(m, e.code, now) : same(m);
    case "retry":
      return m.phase === "reconnecting" && m.socket === 0 ? connect(m) : same(m);
    case "make_code":
      if (m.phase !== "live" || !e.secondDisplay) return same(m);
      return { model: { ...m, codeNote: null }, effects: [{ kind: "send", message: { v: 1, type: "make_code" } }] };
    case "drop":
      if (m.phase !== "live" || m.places[e.slot - 1] === "none") return same(m);
      // A drop ends the current control code too: the shown code goes at once (ADR 0005 section 3).
      return { model: { ...m, places: setPlace(m, e.slot, "none"), code: null, codeNote: null }, effects: [{ kind: "send", message: { v: 1, type: "drop", slot: e.slot } }] };
    case "end":
      return endHere(m, "host_ended");
    case "class_changed":
      return endHere(m, "class_changed");
    case "applied":
      if (m.phase !== "live") return same(m);
      return same({ ...m, line: { slot: e.slot, action: e.action, deltaMs: e.deltaMs, until: now + LINE_MS } });
  }
}

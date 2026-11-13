// The host's live session (ADR 0005 sections 2, 3 and 6): starting it, its connection with the
// reconnect back-off, the phones' places, the control code and its ending. Pure: `step` takes an
// event at monotonic time `now` and says what to do; the main process carries the effects out
// (main/live/live-service.ts). Nothing here can stop or change the class: the clock, the music
// link and the room screen run without it, and a drop only takes the phone away.
//
// - Started only on the instructor's request, while a class is open, by a paired app. Off at each
//   start of the app. The class run ending (another class opened, the window closed) ends it.
// - The host token lives in this state, in the main process's memory, and leaves it only in the
//   `hello` effect. The presenter's view (panel-view.ts) never holds it.
// - A connection lost is tried again after 1, 2, 4, 8 and then every 15 s, for the 15 minutes the
//   live process keeps the session. A `hello` refused on reconnect (4401: the live process
//   restarted), the session ended (4403) or a newer connection with the token (4409) end it here.
// - The control code is offered only with a second display, and is only ever in this state and the
//   presenter's view. A `drop` frees a phone's place and ends the shown code (ADR 0005 section 3).
import type { CodeCancelled } from "../../../../../schema/generated/ts/live-code-cancelled.d.ts";
import type { Drop } from "../../../../../schema/generated/ts/live-drop.d.ts";
import type { End } from "../../../../../schema/generated/ts/live-end.d.ts";
import type { MakeCode } from "../../../../../schema/generated/ts/live-make-code.d.ts";
import type { CompanionAction } from "./actions.ts";
import type { HostInbound, Slot, StartAnswer, StartRefusal, StartedSession } from "./host-wire.ts";

export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 15_000];
/** How long the live process keeps a session after the host's connection is lost. */
export const KEEP_MS = 15 * 60_000;
/** How long the presenter shows "Phone 1: pause" after a phone's command was applied. */
export const LINE_MS = 5000;

/** WebSocket close codes of the live process (backend live_wire_policy.py). */
export const CLOSE_HELLO_REFUSED = 4401;
export const CLOSE_ENDED = 4403;
export const CLOSE_REPLACED = 4409;

export type Phase = "idle" | "starting" | "connecting" | "live" | "reconnecting" | "ended" | "refused";
export type Refusal = StartRefusal | "not_paired" | "no_class";
/** Why a session ended, as the presenter tells it. */
export type EndReason = "host_ended" | "revoked" | "expired" | "lost" | "gone" | "replaced" | "class_changed";
/** A phone's place: never held, held and connected, or held by a phone that is away. */
export type Place = "none" | "connected" | "away";

export interface Applied {
  readonly slot: Slot;
  readonly action: CompanionAction;
  readonly deltaMs: number | null;
  readonly until: number;
}

export interface LiveModel {
  readonly phase: Phase;
  readonly refusal: Refusal | null;
  readonly ended: EndReason | null;
  readonly session: StartedSession | null;
  /** The class run's random id, sent in every state message. */
  readonly run: string | null;
  /** The current connection's number, 0 when there is none; events of older ones are ignored. */
  readonly socket: number;
  readonly sockets: number;
  readonly attempt: number;
  readonly lostAt: number | null;
  readonly places: readonly [Place, Place];
  readonly code: { readonly code: string; readonly expiresAt: number } | null;
  readonly codeNote: Exclude<CodeCancelled["reason"], "replaced"> | null;
  readonly line: Applied | null;
}

export type Credential = "ok" | "none" | "expired";

export type LiveEvent =
  | { readonly type: "start"; readonly run: string; readonly credential: Credential; readonly classOpen: boolean }
  | { readonly type: "answer"; readonly answer: StartAnswer }
  | { readonly type: "open"; readonly socket: number }
  | { readonly type: "message"; readonly socket: number; readonly message: HostInbound }
  | { readonly type: "closed"; readonly socket: number; readonly code: number }
  | { readonly type: "retry" }
  | { readonly type: "make_code"; readonly secondDisplay: boolean }
  | { readonly type: "drop"; readonly slot: Slot }
  | { readonly type: "end" }
  | { readonly type: "class_changed" }
  | { readonly type: "applied"; readonly slot: Slot; readonly action: CompanionAction; readonly deltaMs: number | null };

export type LiveEffect =
  | { readonly kind: "post_session" }
  | { readonly kind: "connect"; readonly socket: number }
  | { readonly kind: "hello"; readonly socket: number; readonly token: string }
  /** The host is in: a fresh send budget, the state at once. */
  | { readonly kind: "welcomed"; readonly socket: number }
  | { readonly kind: "joined" }
  | { readonly kind: "send"; readonly message: MakeCode | Drop | End }
  | { readonly kind: "close"; readonly socket: number }
  | { readonly kind: "retry_in"; readonly ms: number }
  | { readonly kind: "cancel_retry" };

export const OFF: LiveModel = {
  phase: "idle",
  refusal: null,
  ended: null,
  session: null,
  run: null,
  socket: 0,
  sockets: 0,
  attempt: 0,
  lostAt: null,
  places: ["none", "none"],
  code: null,
  codeNote: null,
  line: null,
};

export interface Step {
  readonly model: LiveModel;
  readonly effects: readonly LiveEffect[];
}

const same = (model: LiveModel): Step => ({ model, effects: [] });
const isRunning = (m: LiveModel): boolean => m.phase === "connecting" || m.phase === "live" || m.phase === "reconnecting";

/** Ends the session here: the token is forgotten, the connection closed, no retry left. */
function finish(m: LiveModel, reason: EndReason, extra: readonly LiveEffect[] = []): Step {
  const effects: LiveEffect[] = [...extra];
  if (m.socket !== 0) effects.push({ kind: "close", socket: m.socket });
  if (m.phase === "reconnecting") effects.push({ kind: "cancel_retry" });
  return { model: { ...OFF, phase: "ended", ended: reason, sockets: m.sockets }, effects };
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
      if (refusal !== null) return same({ ...OFF, phase: "refused", refusal, sockets: m.sockets });
      return { model: { ...OFF, phase: "starting", run: e.run, sockets: m.sockets }, effects: [{ kind: "post_session" }] };
    }
    case "answer": {
      if (m.phase !== "starting") return same(m);
      if (!e.answer.ok) return same({ ...OFF, phase: "refused", refusal: e.answer.refusal, sockets: m.sockets });
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
      if (!isRunning(m)) return same(m);
      return finish(m, "host_ended", m.phase === "live" ? [{ kind: "send", message: { v: 1, type: "end" } }] : []);
    case "class_changed":
      if (m.phase === "starting") return same({ ...OFF, phase: "ended", ended: "class_changed", sockets: m.sockets });
      if (!isRunning(m)) return same(m);
      return finish(m, "class_changed", m.phase === "live" ? [{ kind: "send", message: { v: 1, type: "end" } }] : []);
    case "applied":
      if (m.phase !== "live") return same(m);
      return same({ ...m, line: { slot: e.slot, action: e.action, deltaMs: e.deltaMs, until: now + LINE_MS } });
  }
}

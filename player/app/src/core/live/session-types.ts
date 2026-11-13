// The shapes of the host's live session (session-model.ts): its phases, the model, the events it
// takes and the effects it asks for. Pure: types and the state at each start of the app.
import type { CodeCancelled } from "../../../../../schema/generated/ts/live-code-cancelled.d.ts";
import type { Drop } from "../../../../../schema/generated/ts/live-drop.d.ts";
import type { End } from "../../../../../schema/generated/ts/live-end.d.ts";
import type { MakeCode } from "../../../../../schema/generated/ts/live-make-code.d.ts";
import type { CompanionAction } from "./actions.ts";
import type { HostInbound, Slot, StartAnswer, StartRefusal, StartedSession } from "./host-wire.ts";

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
  /** The start request waited for, 0 when there is none; answers of older ones are not taken. */
  readonly request: number;
  readonly requests: number;
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
  | { readonly type: "answer"; readonly request: number; readonly answer: StartAnswer }
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
  | { readonly kind: "post_session"; readonly request: number }
  | { readonly kind: "connect"; readonly socket: number }
  | { readonly kind: "hello"; readonly socket: number; readonly token: string }
  /** The host is in: a fresh send budget, the state at once. */
  | { readonly kind: "welcomed"; readonly socket: number }
  | { readonly kind: "joined" }
  | { readonly kind: "send"; readonly message: MakeCode | Drop | End }
  | { readonly kind: "close"; readonly socket: number }
  | { readonly kind: "retry_in"; readonly ms: number }
  | { readonly kind: "cancel_retry" }
  /**
   * Ends on the backend a session the host is not in (still starting, connecting or reconnecting):
   * a connection of its own that sends `hello` with this token, then `end` (main/live/ender.ts).
   */
  | { readonly kind: "end_session"; readonly token: string };

export const OFF: LiveModel = {
  phase: "idle",
  refusal: null,
  ended: null,
  session: null,
  run: null,
  request: 0,
  requests: 0,
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

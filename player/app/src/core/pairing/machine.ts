// Pairing this computer (ADR 0002, section 6), as a pure state machine: an event and the time in,
// the next state and the effects for the edge to carry out. No I/O, no timers, no clock of its own.
// The device code and the device token live in this state, in the main process; the renderer gets
// only pairingView (view.ts), which holds neither.
import type { OriginResult } from "./origin.ts";
import type { DeviceAnswer, PollAnswer, StartAnswer } from "./protocol.ts";
import type { PairingRecord } from "./record.ts";

/** Why the app is not paired, said once to the user. */
export type Notice = "no_server" | "no_keychain" | "too_many" | "unreachable" | "unexpected" | "denied" | "code_expired" | "save_failed" | "revoked_on_site" | "unpaired";

export type PairingState =
  | { readonly kind: "unpaired"; readonly attempt: number; readonly notice: Notice | null }
  | { readonly kind: "starting"; readonly attempt: number; readonly origin: string }
  | {
      readonly kind: "waiting";
      readonly attempt: number;
      readonly origin: string;
      readonly deviceCode: string;
      readonly userCode: string;
      readonly page: string;
      readonly expiresAt: number;
      readonly intervalMs: number;
      /** True while a poll is out: never two at once. */
      readonly polling: boolean;
    }
  | { readonly kind: "paired"; readonly attempt: number; readonly record: PairingRecord; readonly deviceName: string | null; readonly expired: boolean };

export type Effect =
  | { readonly do: "start"; readonly attempt: number; readonly origin: string }
  | { readonly do: "open_page"; readonly page: string }
  /** Send `poll_due` for this attempt at `at` (the edge's one timer). */
  | { readonly do: "wake"; readonly attempt: number; readonly at: number }
  | { readonly do: "poll"; readonly attempt: number; readonly origin: string; readonly deviceCode: string }
  | { readonly do: "save"; readonly attempt: number; readonly record: PairingRecord }
  | { readonly do: "check"; readonly attempt: number; readonly record: PairingRecord }
  | { readonly do: "forget" }
  | { readonly do: "revoke"; readonly record: PairingRecord };

export type PairingEvent =
  | { readonly type: "loaded"; readonly record: PairingRecord | null }
  | { readonly type: "start"; readonly origin: OriginResult; readonly keychain: boolean }
  | { readonly type: "started"; readonly attempt: number; readonly answer: StartAnswer }
  | { readonly type: "poll_due"; readonly attempt: number }
  | { readonly type: "polled"; readonly attempt: number; readonly answer: PollAnswer }
  | { readonly type: "saved"; readonly attempt: number; readonly ok: boolean }
  | { readonly type: "checked"; readonly attempt: number; readonly answer: DeviceAnswer }
  | { readonly type: "unpair" };

export interface Step {
  readonly state: PairingState;
  readonly effects: readonly Effect[];
}

/** The server's interval is exact; each poll goes this much later so it is never early. */
export const POLL_MARGIN_MS = 500;
/** RFC 8628, section 3.5: each `slow_down` adds 5 seconds. */
export const SLOW_DOWN_STEP_MS = 5000;
export const MAX_INTERVAL_MS = 60_000;

export const INITIAL: PairingState = { kind: "unpaired", attempt: 0, notice: null };

const stay = (state: PairingState): Step => ({ state, effects: [] });
const unpaired = (attempt: number, notice: Notice | null, effects: readonly Effect[] = []): Step => ({ state: { kind: "unpaired", attempt, notice }, effects });

type Waiting = Extract<PairingState, { kind: "waiting" }>;

/** The next poll, after `waitMs` and the margin, but never past the pairing's end. */
function wait(s: Waiting, now: number, waitMs: number): Step {
  const at = Math.min(now + waitMs + POLL_MARGIN_MS, s.expiresAt);
  return { state: { ...s, polling: false }, effects: [{ do: "wake", attempt: s.attempt, at }] };
}

function polled(s: Waiting, answer: PollAnswer, now: number): Step {
  switch (answer.kind) {
    case "ok": {
      const record: PairingRecord = { origin: s.origin, token: answer.token, email: answer.email };
      return { state: { kind: "paired", attempt: s.attempt, record, deviceName: null, expired: false }, effects: [{ do: "save", attempt: s.attempt, record }] };
    }
    case "authorization_pending":
      return wait(s, now, s.intervalMs);
    case "slow_down": {
      const intervalMs = Math.min(s.intervalMs + SLOW_DOWN_STEP_MS, MAX_INTERVAL_MS);
      return wait({ ...s, intervalMs }, now, intervalMs);
    }
    case "retry":
      return wait(s, now, Math.max(s.intervalMs, Math.min(answer.afterMs ?? 0, MAX_INTERVAL_MS)));
    case "access_denied":
      return unpaired(s.attempt, "denied");
    case "expired_token":
      return unpaired(s.attempt, "code_expired");
    case "unexpected":
      return unpaired(s.attempt, "unexpected");
  }
}

function started(s: Extract<PairingState, { kind: "starting" }>, answer: StartAnswer, now: number): Step {
  if (answer.kind !== "started") return unpaired(s.attempt, answer.kind === "too_many" ? "too_many" : answer.kind);
  const waiting: Waiting = {
    kind: "waiting",
    attempt: s.attempt,
    origin: s.origin,
    deviceCode: answer.deviceCode,
    userCode: answer.userCode,
    page: answer.page,
    expiresAt: now + answer.expiresInMs,
    intervalMs: answer.intervalMs,
    polling: false,
  };
  const next = wait(waiting, now, waiting.intervalMs);
  return { state: next.state, effects: [{ do: "open_page", page: answer.page }, ...next.effects] };
}

export function step(s: PairingState, e: PairingEvent, now: number): Step {
  switch (e.type) {
    case "loaded":
      if (s.kind !== "unpaired" || s.attempt !== 0 || e.record === null) return stay(s);
      return { state: { kind: "paired", attempt: 1, record: e.record, deviceName: null, expired: false }, effects: [{ do: "check", attempt: 1, record: e.record }] };
    case "start": {
      // A working pairing is ended with Unpair first; one the server no longer takes may pair again.
      if (s.kind === "starting" || s.kind === "waiting" || (s.kind === "paired" && !s.expired)) return stay(s);
      const attempt = s.attempt + 1;
      if (!e.origin.ok) return unpaired(attempt, "no_server");
      // No keychain, no pairing: the token is never kept where it could be read in the clear.
      if (!e.keychain) return unpaired(attempt, "no_keychain");
      return { state: { kind: "starting", attempt, origin: e.origin.origin }, effects: [{ do: "start", attempt, origin: e.origin.origin }] };
    }
    case "started":
      return s.kind === "starting" && s.attempt === e.attempt ? started(s, e.answer, now) : stay(s);
    case "poll_due":
      if (s.kind !== "waiting" || s.attempt !== e.attempt || s.polling) return stay(s);
      if (now >= s.expiresAt) return unpaired(s.attempt, "code_expired");
      return { state: { ...s, polling: true }, effects: [{ do: "poll", attempt: s.attempt, origin: s.origin, deviceCode: s.deviceCode }] };
    case "polled":
      return s.kind === "waiting" && s.attempt === e.attempt && s.polling ? polled(s, e.answer, now) : stay(s);
    case "saved":
      if (s.kind !== "paired" || s.attempt !== e.attempt || e.ok) return stay(s);
      // The token could not be kept: it is given back, so no device row waits for a holder.
      return unpaired(s.attempt, "save_failed", [{ do: "revoke", record: s.record }]);
    case "checked":
      if (s.kind !== "paired" || s.attempt !== e.attempt) return stay(s);
      if (e.answer.kind === "ok") return stay({ ...s, deviceName: e.answer.name, expired: false });
      if (e.answer.kind === "expired") return stay({ ...s, expired: true });
      // Revoked on the site or unknown to the server: the token is deleted. A network error or a
      // server fault ("unknown") changes nothing.
      return e.answer.kind === "gone" ? unpaired(s.attempt + 1, "revoked_on_site", [{ do: "forget" }]) : stay(s);
    case "unpair":
      if (s.kind === "unpaired") return stay(s);
      // Deleted here first, then given back to the server; offline, it is deleted all the same.
      if (s.kind === "paired") return unpaired(s.attempt + 1, "unpaired", [{ do: "forget" }, { do: "revoke", record: s.record }]);
      return unpaired(s.attempt + 1, null);
  }
}

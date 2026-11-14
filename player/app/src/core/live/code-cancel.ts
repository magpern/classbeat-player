// Ending a control code the app stops offering (ADR 0005 section 10, amended 2026-11-14; #353).
// "An app with one display offers no control code" (section 3): when only one display is left
// while the model holds a control code, the code goes from the model at once and `cancel_code`
// ends it on the server too, so the server never honours a code the screen no longer shows.
// While the host's connection is down the cancel waits and goes right after the next `welcome`,
// ahead of everything else, and so does a `cancel_code` still queued when the connection was lost
// (held-over.ts, #381). Pure: the main process says when only one display is left.
import type { CancelCode } from "../../../../../schema/generated/ts/live-cancel-code.d.ts";
import type { LiveModel, Step } from "./session-types.ts";

export const CANCEL_CODE: CancelCode = { v: 1, type: "cancel_code" };

/** Only one display is left: the control code held, if any, ends here and on the server. */
export function oneDisplay(m: LiveModel): Step {
  if (m.code === null) return { model: m, effects: [] };
  const model: LiveModel = { ...m, code: null, codeNote: null };
  if (m.phase === "live") return { model, effects: [{ kind: "send", message: CANCEL_CODE }] };
  if (m.phase === "reconnecting") return { model: { ...model, cancelPending: true }, effects: [] };
  return { model, effects: [] };
}

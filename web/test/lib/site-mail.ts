// The fake backend's `POST sign-in/link` with its mail (ADR 0002, section 4, steps 1 to 4, amended
// by ADR 0006, decisions 1 and 3): the checks of the request, in the backend's order, and the link
// the mail would carry. The fake site answers with it when a test gives it a mailbox. No I/O.
import { LINK_TOKEN } from "./site-states.ts";

/** ADR 0006, decision 1: exactly this, upper case with its hyphen, in `code_policy.ALPHABET`. */
export const RETURN_TO = /^control(\.[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4})?$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface LinkAnswer {
  readonly status: number;
  readonly body: unknown;
  /** The link the mail carries, when one is sent. */
  readonly link?: string;
}

/**
 * The answer to a link request body (the per-address limit, which comes first, is the script's).
 * Then `email`, then `return_to`: missing or JSON null is no entry, any other value that is not
 * exactly an entry is `422 invalid_return`, and neither 422 sends a mail.
 */
export function linkRequest(origin: string, body: string | null): LinkAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? "");
  } catch {
    return { status: 422, body: { error: "invalid_email" } };
  }
  const o = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  if (typeof o.email !== "string" || !EMAIL.test(o.email)) return { status: 422, body: { error: "invalid_email" } };
  const back = o.return_to;
  if (back !== undefined && back !== null && (typeof back !== "string" || !RETURN_TO.test(back))) return { status: 422, body: { error: "invalid_return" } };
  const link = typeof back === "string" ? `${origin}/sign-in#${LINK_TOKEN}&return=${back}` : `${origin}/sign-in#${LINK_TOKEN}`;
  return { status: 200, body: { status: "accepted" }, link };
}

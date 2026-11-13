// What an answer of the site's API means to a page (docs/design/site.md, "Errors"). Pure: no I/O.
// Codes are never shown; a page acts on the kind.

export type Answer =
  | { readonly kind: "ok"; readonly status: number; readonly body: unknown }
  | { readonly kind: "not_signed_in" }
  | { readonly kind: "too_many"; readonly retryAfter: number | null }
  | { readonly kind: "refused"; readonly status: number; readonly code: string }
  | { readonly kind: "offline" }
  | { readonly kind: "server" };

const CODE = /^[a-z][a-z_]{0,63}$/;

function codeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" && CODE.test(code) ? code : null;
}

/** `Retry-After` as whole seconds; an HTTP date or anything else is not used. */
export function retryAfterOf(header: string | null): number | null {
  if (header === null || !/^\d{1,9}$/.test(header.trim())) return null;
  return Number(header.trim());
}

/**
 * The meaning of one answer. A 403 `cross_site_request` and anything not understood are the
 * server fault (the spec shows no code and no technical word).
 */
export function answerOf(status: number, retryAfter: string | null, body: unknown): Answer {
  if (status >= 200 && status < 300) return { kind: "ok", status, body };
  if (status === 429) return { kind: "too_many", retryAfter: retryAfterOf(retryAfter) };
  const code = codeOf(body);
  if (status === 401 && code === "not_signed_in") return { kind: "not_signed_in" };
  if (status >= 400 && status < 500 && code !== null && code !== "cross_site_request") return { kind: "refused", status, code };
  return { kind: "server" };
}

/** "in about 40 minutes", from `Retry-After` in seconds, rounded up; "in a few minutes" without one. */
export function waitWords(seconds: number | null): string {
  if (seconds === null) return "in a few minutes";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "in about 1 minute" : `in about ${minutes} minutes`;
}

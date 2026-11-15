// Confirming it is you with classbeat (ADR 0010, sections 2 and 5): what the answer of
// `POST sign-in/classbeat/start` with purpose `reauth` means, and which address the page may go
// to. Pure: no I/O. The start carries no return entry (section 6): the body is the purpose only.
// classbeat's callback lands on /classes, so the change is made again by hand afterwards.
import type { Answer } from "./answer.ts";
import type { Plate } from "./sign-in-model.ts";

/** The one body the site sends to start a re-authentication: no `return_to`, ever. */
export const REAUTH_BODY = { purpose: "reauth" } as const;

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
const printable = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) >= 0x21 && c.charCodeAt(0) <= 0x7e);

/**
 * classbeat's authorize address from the start's body, or null for one the page does not go to:
 * HTTPS (HTTP only on this computer, for development), no user or password in it, printable,
 * no backslash (the browser and the backend could read the host differently) and at most 4000
 * characters.
 */
export function authorizeOf(body: unknown): string | null {
  const to = typeof body === "object" && body !== null ? (body as { authorize?: unknown }).authorize : undefined;
  if (typeof to !== "string" || to.length > 4000 || !printable(to) || to.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(to);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname)) ? to : null;
}

export type StartNext = { readonly kind: "go"; readonly to: string } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: Plate };

/** After the start: go to classbeat, the session ended (a 401), or a plate (the limit, offline, anything else). */
export function afterReauthStart(a: Answer): StartNext {
  if (a.kind === "not_signed_in") return { kind: "ended" };
  if (a.kind === "too_many") return { kind: "plate", plate: { kind: "too-many", retryAfter: a.retryAfter } };
  if (a.kind === "offline") return { kind: "plate", plate: { kind: "offline" } };
  const to = a.kind === "ok" ? authorizeOf(a.body) : null;
  return to === null ? { kind: "plate", plate: { kind: "server" } } : { kind: "go", to };
}

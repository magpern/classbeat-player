// Signing in and confirming it is you with classbeat (ADR 0010, sections 2, 5 and 6): what the
// answer of `POST sign-in/classbeat/start` means, which address the page may go to, and what the
// callback's refusal (`/sign-in#error=classbeat`) means once `GET me` has answered. Pure: no I/O.
// The start carries no return entry (section 6): the body is the purpose only. classbeat's
// callback lands on /classes, so a change is made again by hand afterwards.
import type { Answer } from "./answer.ts";
import type { Plate } from "./sign-in-model.ts";

/** The one body the site sends to start a re-authentication: no `return_to`, ever. */
export const REAUTH_BODY = { purpose: "reauth" } as const;
/** The one body the sign-in page sends to sign in with classbeat: no `return_to`, ever (section 6). */
export const SIGN_IN_BODY = { purpose: "sign_in" } as const;

/** The one fragment the callback's refusal carries (ADR 0010, section 2). Only this exact value is read. */
export const CLASSBEAT_ERROR = "#error=classbeat";
export const isClassbeatError = (hash: string): boolean => hash === CLASSBEAT_ERROR;

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

/** After the sign-in page's start: go to classbeat, or a plate (its own limit, offline, anything else). Never "ended": no session is asked for. */
export function afterSignInStart(a: Answer): StartNext {
  if (a.kind === "too_many") return { kind: "plate", plate: { kind: "classbeat-limited", retryAfter: a.retryAfter } };
  if (a.kind === "offline") return { kind: "plate", plate: { kind: "offline" } };
  const to = a.kind === "ok" ? authorizeOf(a.body) : null;
  return to === null ? { kind: "plate", plate: { kind: "server" } } : { kind: "go", to };
}

/**
 * What `#error=classbeat` means, from `GET me`: a sign-in that did not finish (401), a
 * re-authentication classbeat did not confirm while the person is still signed in (200), or no
 * way to tell (the check itself failed), which offers no sign-in action.
 */
export type ErrorCheck =
  | { readonly kind: "unfinished" }
  | { readonly kind: "still-signed-in" }
  | { readonly kind: "failed"; readonly why: "offline" | "server" }
  | { readonly kind: "failed"; readonly why: "too-many"; readonly retryAfter: number | null };

export function afterErrorCheck(a: Answer): ErrorCheck {
  if (a.kind === "not_signed_in") return { kind: "unfinished" };
  if (a.kind === "ok") return { kind: "still-signed-in" };
  if (a.kind === "too_many") return { kind: "failed", why: "too-many", retryAfter: a.retryAfter };
  return { kind: "failed", why: a.kind === "offline" ? "offline" : "server" };
}

/** The words of "classbeat did not confirm (still signed in)" and of the check before it. */
export const NOT_CONFIRMED_WORDS = {
  title: "Confirm it is you",
  head: "classbeat did not confirm it is you",
  detail: "You may have signed in at classbeat as a different user. You are still signed in here, and nothing was changed. Sign in at classbeat as the same user, then make the change again.",
  back: "Back to your classes",
  checking: "Checking your sign-in…",
} as const;

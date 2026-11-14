// Connect an app (docs/design/site.md, "Account"; ADR 0002, section 7, steps 2 to 4): what the
// source put in the page's address, and how each answer of `POST source-links/check` and
// `POST source-links/approve` moves the page. Pure: no I/O.
//
// The page's own address never chooses where the page goes. Its query only names what the source
// asks for, and that goes to the backend in a request body, which decides. The one address the
// page ever leaves for is the `redirect` the approval answers with, and only when that answer is
// the address that was asked for with the code and the state added (so a `javascript:` address,
// another site or an address of this site is never followed, whatever the answer says).
import type { Answer } from "./answer.ts";
import type { AccountPlate } from "./account-model.ts";
import { plateOf } from "./account-model.ts";

/** What the source asks for, from the query of `/link/source`. */
export interface LinkAsk {
  readonly source: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string | null;
}

/** The backend's field limits (`player_backend.site.source_links`): a longer value is not a link. */
const LIMITS = { source: 40, redirect_uri: 2000, state: 500, code_challenge: 100, code_challenge_method: 10 } as const;

/** The one value of a parameter, or null when it is missing, given twice, empty or too long. */
function one(q: URLSearchParams, name: keyof typeof LIMITS): string | null {
  const all = q.getAll(name);
  return all.length === 1 && all[0] !== "" && all[0].length <= LIMITS[name] ? all[0] : null;
}

/**
 * What the query asks for, or null when it is not a link a source would make. Any other parameter
 * (`next`, `return_to`, `redirect`, …) is ignored: it is never read for anything.
 */
export function askOf(search: string): LinkAsk | null {
  const q = new URLSearchParams(search);
  const source = one(q, "source");
  const redirectUri = one(q, "redirect_uri");
  const state = one(q, "state");
  const codeChallenge = one(q, "code_challenge");
  const methods = q.getAll("code_challenge_method");
  const method = methods.length === 0 ? null : one(q, "code_challenge_method");
  if (source === null || redirectUri === null || state === null || codeChallenge === null || (methods.length > 0 && method === null)) return null;
  return { source, redirectUri, state, codeChallenge, codeChallengeMethod: method };
}

/** The body of `POST source-links/check`. */
export const checkBody = (a: LinkAsk): { source: string; redirect_uri: string } => ({ source: a.source, redirect_uri: a.redirectUri });

/** The body of `POST source-links/approve`: the method only when the source gave one. */
export function approveBody(a: LinkAsk): Record<string, string> {
  const body: Record<string, string> = { source: a.source, redirect_uri: a.redirectUri, state: a.state, code_challenge: a.codeChallenge };
  if (a.codeChallengeMethod !== null) body.code_challenge_method = a.codeChallengeMethod;
  return body;
}

/** What a link may let the source do, in the person's words, by the scope the backend names. */
export const SCOPE_WORDS: Readonly<Record<string, string>> = {
  publish_classes: "Send classes to your library",
  remove_classes: "Remove the classes it sent",
  read_publication_numbers: "Read how many times it has sent each class",
};

export type LinkPlate = { readonly kind: "not-valid" } | { readonly kind: "limit" } | AccountPlate;

/** After the check: the question to ask, the session ended, or a plate (nothing is asked then). */
export type CheckNext = { readonly kind: "ask"; readonly name: string; readonly scope: readonly string[] } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: LinkPlate };

/** A refusal of the link itself: an unknown source or address (400), or a part of it the backend does not take (422). */
const refusesLink = (a: Answer): boolean => a.kind === "refused" && (a.status === 400 || a.status === 422);

function notOk(a: Answer): CheckNext & { kind: "ended" | "plate" } {
  if (a.kind === "not_signed_in") return { kind: "ended" };
  if (refusesLink(a)) return { kind: "plate", plate: { kind: "not-valid" } };
  return { kind: "plate", plate: plateOf(a) };
}

/**
 * The answer to the check. The name is the backend's, shown as text. A scope the page cannot put
 * into words, or an answer for another source, is the server fault: the person is never asked to
 * approve something the page cannot describe.
 */
export function afterCheck(ask: LinkAsk, a: Answer): CheckNext {
  if (a.kind !== "ok") return notOk(a);
  const b = (typeof a.body === "object" && a.body !== null ? a.body : {}) as Record<string, unknown>;
  const scope = b.scope;
  const named = typeof b.name === "string" && b.name.trim() !== "" && b.name.length <= 40;
  const described = Array.isArray(scope) && scope.length > 0 && scope.every((s) => typeof s === "string" && Object.hasOwn(SCOPE_WORDS, s));
  if (b.source !== ask.source || !named || !described) return { kind: "plate", plate: { kind: "server" } };
  return { kind: "ask", name: b.name as string, scope: scope as string[] };
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
/** Printable ASCII without spaces only, as the backend's addresses are. */
const printable = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) >= 0x21 && c.charCodeAt(0) <= 0x7e);

/**
 * The address to go back to, or null. Only the address that was asked for (which the backend
 * checked against the source's own list), with the query the approval added: HTTPS, or HTTP on
 * this computer as the backend allows for development.
 */
export function backAddressOf(ask: LinkAsk, redirect: unknown): string | null {
  if (typeof redirect !== "string" || redirect.length > 4000 || !printable(redirect)) return null;
  if (!redirect.startsWith(`${ask.redirectUri}?`) || ask.redirectUri.includes("?") || ask.redirectUri.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))) return redirect;
  return null;
}

/** After the approval: back to the source by the address the route gave, the session ended, or a plate. */
export type ApproveNext = { readonly kind: "done"; readonly to: string } | { readonly kind: "ended" } | { readonly kind: "plate"; readonly plate: LinkPlate };

export function afterApprove(ask: LinkAsk, a: Answer): ApproveNext {
  if (a.kind === "refused" && a.status === 409 && a.code === "too_many_links") return { kind: "plate", plate: { kind: "limit" } };
  if (a.kind !== "ok") return notOk(a);
  const body = typeof a.body === "object" && a.body !== null ? (a.body as { redirect?: unknown }) : {};
  const to = backAddressOf(ask, body.redirect);
  return to === null ? { kind: "plate", plate: { kind: "server" } } : { kind: "done", to };
}

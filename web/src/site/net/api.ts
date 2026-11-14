// The one way the site talks to its backend: a same-origin request to /api/site/ with the
// session cookie, which the browser sends and the page never reads (ADR 0002, section 5).
// Nothing a request carries is logged or kept.
import { answerOf } from "../core/answer.ts";
import type { Answer } from "../core/answer.ts";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** Sends one request with the site's options; null when there is no answer at all. */
export async function send(method: Method, route: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(`/api/site/${route}`, {
      method,
      // Kept explicit: in `cors` mode the browser sends the real Origin even under
      // `Referrer-Policy: no-referrer`; another mode may send `Origin: null`, which the backend
      // refuses as cross-site (Fetch, "append a request Origin header").
      mode: "cors",
      credentials: "same-origin",
      cache: "no-store",
      // A redirect is never followed: it is an answer the page does not understand.
      redirect: "manual",
      referrerPolicy: "no-referrer",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // No answer at all.
    return null;
  }
}

/** The meaning of an answer that is not a success, read from its JSON body. */
export async function answerOfResponse(res: Response): Promise<Answer> {
  if (res.type === "opaqueredirect") return { kind: "server" };
  let parsed: unknown = null;
  if (res.status !== 204) {
    try {
      parsed = await res.json();
    } catch {
      return { kind: "server" };
    }
  }
  return answerOf(res.status, res.headers.get("Retry-After"), parsed);
}

export async function call(method: Method, route: string, body?: unknown): Promise<Answer> {
  const res = await send(method, route, body);
  return res === null ? { kind: "offline" } : answerOfResponse(res);
}

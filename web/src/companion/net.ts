// The page's HTTP requests, all to its own origin (ADR 0005 section 4, ADR 0002 section 5):
// - `POST /api/live/controller` (by sign-in: the site's session cookie goes with it) and
//   `POST /api/live/control` (by control code: no credential), each a JSON body;
// - `GET /api/site/sessions`, only to learn whether this browser is signed in (200) or not; its
//   body is not read.
// No query string, no referrer, never cached. A controller token in an answer goes to the caller
// and nowhere else; nothing here logs.
import type { HttpAnswer } from "./core/answer.ts";
import type { Request } from "./core/entry.ts";

const BASE: RequestInit = { credentials: "same-origin", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error" };
/** Longer than any answer of these routes; a bigger body is not read. */
const MAX_ANSWER_CHARS = 4096;

async function read(r: Response): Promise<HttpAnswer> {
  const text = await r.text();
  let body: unknown = null;
  if (text.length <= MAX_ANSWER_CHARS && (r.headers.get("content-type") ?? "").startsWith("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { kind: "answer", status: r.status, body };
}

export async function post(req: Request): Promise<HttpAnswer> {
  try {
    const r = await fetch(`/api/live/${req.route}`, { ...BASE, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    return await read(r);
  } catch {
    return { kind: "unreachable" };
  }
}

/** Whether the site has a session for this browser: true, false, or null when it could not say. */
export async function signedIn(): Promise<boolean | null> {
  try {
    const r = await fetch("/api/site/sessions", { ...BASE, method: "GET" });
    await r.body?.cancel();
    if (r.status === 200) return true;
    return r.status === 401 ? false : null;
  } catch {
    return null;
  }
}

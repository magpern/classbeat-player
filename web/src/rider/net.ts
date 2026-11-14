// The page's one HTTP request, `POST /api/live/join` on its own origin (ADR 0007 section 1). The
// body is the join form's `send`: exactly `session` and `nickname`, never the rider's numbers. No
// credential, no query string, no referrer, never cached. The rider token in the answer goes to
// the caller and nowhere else; nothing here logs.
import type { JoinRequest } from "../../../schema/generated/ts/live-join-request.d.ts";
import type { HttpAnswer } from "./core/join.ts";

const BASE: RequestInit = { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error" };
/** Longer than any answer of this route; a bigger body is not read. */
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

export async function join(send: JoinRequest): Promise<HttpAnswer> {
  const body = JSON.stringify({ session: send.session, nickname: send.nickname });
  try {
    const r = await fetch("/api/live/join", { ...BASE, method: "POST", headers: { "Content-Type": "application/json" }, body });
    return await read(r);
  } catch {
    return { kind: "unreachable" };
  }
}

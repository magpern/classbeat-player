// The one place the shell talks to the backend: JSON over HTTPS (loopback HTTP in development),
// from the main process only. Never follows a redirect, never waits long, never reads a big body,
// never throws and never logs: every failure is "unreachable". The device token goes only in
// `Authorization: Bearer`, never in an address.
import type { HttpAnswer } from "../../core/pairing/protocol.ts";

export interface BackendRequest {
  readonly origin: string;
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: `/api/${string}`;
  readonly body?: Readonly<Record<string, string>>;
  readonly token?: string;
  /** A larger cap than `MAX_BODY_BYTES`, for an answer that carries a class document. */
  readonly maxBodyBytes?: number;
}

export type BackendCall = (req: BackendRequest) => Promise<HttpAnswer>;

export const TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 64 * 1024;
const MAX_RETRY_AFTER_S = 3600;

function retryAfter(raw: string | null): number | null {
  if (raw === null || !/^\d{1,5}$/.test(raw.trim())) return null;
  const s = Number(raw.trim());
  return s <= MAX_RETRY_AFTER_S ? s : MAX_RETRY_AFTER_S;
}

/** The body as JSON, or undefined when it is not JSON or is larger than the cap. */
async function readJson(res: Response, max: number): Promise<unknown> {
  if (res.body === null) return undefined;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function createBackendCall(fetchImpl: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): BackendCall {
  return async (req) => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (req.body !== undefined) headers["content-type"] = "application/json";
    if (req.token !== undefined) headers.authorization = `Bearer ${req.token}`;
    try {
      const res = await fetchImpl(new URL(req.path, req.origin), {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await readJson(res, req.maxBodyBytes ?? MAX_BODY_BYTES);
      return { kind: "http", status: res.status, body, retryAfterS: retryAfter(res.headers.get("retry-after")) };
    } catch {
      // Nothing from the error is kept: it could quote the request.
      return { kind: "unreachable" };
    }
  };
}

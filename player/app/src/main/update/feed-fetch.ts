// The release feed's one request (ADR 0014, section 1), in the pattern of pairing/http.ts: from the
// main process only, `https:` only, no redirect followed, 10 s at most, 1 MiB at most, never throws
// and never logs. It sends a User-Agent naming the player and its version and nothing else of the
// player's: no cookie, token, device ID or class data. Every failure is null ("could not check").
import { parseFeedAddress } from "../../core/update/feed-address.ts";

export const FEED_TIMEOUT_MS = 10_000;
export const MAX_FEED_BYTES = 1024 * 1024;

/** The feed reply's text, or null on any failure. */
export type FeedFetch = (address: string) => Promise<string | null>;

/** The body as text, or null when it is larger than the cap (the read stops there). */
async function readText(res: Response, max: number): Promise<string | null> {
  if (res.body === null) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createFeedFetch(version: string, fetchImpl: typeof fetch = fetch, timeoutMs = FEED_TIMEOUT_MS): FeedFetch {
  const userAgent = `classbeat-player/${version}`;
  return async (address) => {
    // Checked again here, so no caller can make this reach anything but an https: address.
    const url = parseFeedAddress(address);
    if (url === null) return null;
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/vnd.github+json", "user-agent": userAgent },
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readText(res, MAX_FEED_BYTES);
    } catch {
      // Nothing from the error is kept: it could quote the request.
      return null;
    }
  };
}

// The answer to one `cbp-mix:` request (ADR 0013 section 5), without Electron so a test can drive
// it. Only a GET of a live play's URL is answered: the bytes of the play's cached mix, decrypted
// one chunk at a time in memory (main/mix/mix-reader.ts) as the stream is read, with one byte range
// at most. The answer is never stored (`no-store`) and names nothing: no token, path, mix id,
// account or source. Any other request gets an empty 404. A chunk still downloading is waited for;
// after `waitMs` the stream fails and the play falls back ("downloading"), as it does on a chunk
// that fails its check ("not_checked").
import { CHUNK_BYTES } from "../../core/mix/cache-crypto.ts";
import { byteRange, playIdOf } from "../../core/mix/scheme-policy.ts";
import type { MixReader } from "./mix-reader.ts";
import type { Play } from "./plays.ts";

export type PlayFault = "downloading" | "not_checked";

export interface MixResponseDeps {
  readonly live: (id: string) => Play | null;
  readonly open: (account: string, mixId: string) => MixReader | null;
  /** The play could not go on; called once per failed stream, with the play's id. */
  readonly onFault: (playId: string, fault: PlayFault) => void;
  /** How long a chunk the sound needs may stay unwritten (10 s, docs/design/swedebeat.md). */
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export const CHUNK_WAIT_MS = 10_000;
const POLL_MS = 100;

const HEADERS = { "Cache-Control": "no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
const empty = (status: number, extra: Record<string, string> = {}): Response => new Response(null, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function answerMixRequest(req: Request, d: MixResponseDeps): Promise<Response> {
  if (req.method !== "GET") return empty(405);
  const id = playIdOf(req.url);
  const play = id === null ? null : d.live(id);
  if (id === null || play === null) return empty(404);
  const reader = d.open(play.account, play.mixId);
  if (reader === null) {
    d.onFault(id, "downloading");
    return empty(404);
  }
  const range = byteRange(req.headers.get("range"), reader.byteLength);
  if (range === "unsatisfiable") return empty(416, { "Content-Range": `bytes */${reader.byteLength}` });
  const partial = req.headers.get("range") !== null;
  const body = chunkStream(id, play, reader, range.start, range.end, d);
  const headers: Record<string, string> = { ...HEADERS, "Content-Length": String(range.end - range.start + 1) };
  if (partial) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${reader.byteLength}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}

function chunkStream(id: string, play: Play, reader: MixReader, start: number, end: number, d: MixResponseDeps): ReadableStream<Uint8Array> {
  const waitMs = d.waitMs ?? CHUNK_WAIT_MS;
  const pollMs = d.pollMs ?? POLL_MS;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = d.now ?? (() => Date.now());
  let i = Math.floor(start / CHUNK_BYTES);
  const last = Math.floor(end / CHUNK_BYTES);
  let cancelled = false;
  const fail = (c: ReadableStreamDefaultController<Uint8Array>, fault: PlayFault): void => {
    d.onFault(id, fault);
    c.error(new Error("mix unavailable"));
  };
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      const until = now() + waitMs;
      for (;;) {
        // A play that ended (stop, another class, sign-out) gets no more bytes.
        if (cancelled || d.live(id) !== play) return c.error(new Error("play ended"));
        const r = await reader.readChunk(i);
        if (r.ok) {
          const from = i * CHUNK_BYTES;
          const a = Math.max(start - from, 0);
          const b = Math.min(end - from + 1, r.plain.length);
          c.enqueue(new Uint8Array(r.plain.subarray(a, b)));
          if (i++ === last) c.close();
          return;
        }
        if (r.reason === "bad") return fail(c, "not_checked");
        if (r.reason === "gone" || now() >= until) return fail(c, "downloading");
        await sleep(pollMs);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}

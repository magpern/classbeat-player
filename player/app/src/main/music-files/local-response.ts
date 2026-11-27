// The answer to one `cbp-local:` request (ADR 0017 section 3), without Electron so a test can drive
// it. Only a GET of a live play's URL is answered: the bytes of the indexed, checked file the play's
// song names, read where it is (nothing is copied, converted or cached), with one byte range at most.
// The file is opened without following a symbolic link where the system can refuse one and without
// hanging on a planted pipe, and it must still be a plain file of the indexed size and modification
// time once open. The answer is never stored (`no-store`) and names nothing: no path, file name,
// hash, account or class. Any other request gets an empty 404; a file that is gone or changed, or a
// read that fails, ends the play's stream and is reported once, by the play's id only.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { IndexedFile } from "../../core/music-files/index-model.ts";
import { localPlayIdOf } from "../../core/music-files/local-scheme-policy.ts";
import { byteRange } from "../../core/mix/scheme-policy.ts";

/** What the answer needs of a live play: whose index to read and which file the song names. */
export interface LocalPlayFile {
  readonly account: string;
  readonly sha256: string;
  readonly size: number;
}

export interface LocalResponseDeps {
  readonly live: (id: string) => LocalPlayFile | null;
  /** The account's indexed file of this hash, or null. */
  readonly indexed: (account: string, sha256: string) => IndexedFile | null;
  /** The play could not go on; called once per failed request or stream, with the play's id. */
  readonly onFault: (playId: string) => void;
}

const CHUNK = 256 * 1024;
const HEADERS = { "Cache-Control": "no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
const empty = (status: number, extra: Record<string, string> = {}): Response => new Response(null, { status, headers: { "Cache-Control": "no-store", ...extra } });

/** The indexed file, opened and still the file the index holds, or null; never an error that could carry the path. */
async function openIndexed(f: IndexedFile): Promise<FileHandle | null> {
  let handle: FileHandle;
  try {
    handle = await open(f.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    const st = await handle.stat();
    if (st.isFile() && st.size === f.size && st.mtimeMs === f.mtimeMs) return handle;
  } catch {
    // Falls through: closed below.
  }
  await handle.close().catch(() => undefined);
  return null;
}

export async function answerLocalRequest(req: Request, d: LocalResponseDeps): Promise<Response> {
  if (req.method !== "GET") return empty(405);
  const id = localPlayIdOf(req.url);
  const play = id === null ? null : d.live(id);
  if (id === null || play === null) return empty(404);
  const f = d.indexed(play.account, play.sha256);
  const handle = f === null || f.size !== play.size ? null : await openIndexed(f);
  if (handle === null) {
    d.onFault(id);
    return empty(404);
  }
  const range = byteRange(req.headers.get("range"), play.size);
  if (range === "unsatisfiable") {
    await handle.close().catch(() => undefined);
    return empty(416, { "Content-Range": `bytes */${play.size}` });
  }
  const partial = req.headers.get("range") !== null;
  const headers: Record<string, string> = { ...HEADERS, "Content-Length": String(range.end - range.start + 1) };
  if (partial) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${play.size}`;
  return new Response(fileStream(id, play, handle, range.start, range.end, d), { status: partial ? 206 : 200, headers });
}

function fileStream(id: string, play: LocalPlayFile, handle: FileHandle, start: number, end: number, d: LocalResponseDeps): ReadableStream<Uint8Array> {
  let at = start;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    void handle.close().catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      // A play that ended (its song stopped, the class stopped, the window closed, sign-out) gets no more bytes.
      if (closed || d.live(id) !== play) {
        close();
        return c.error(new Error("play ended"));
      }
      try {
        const buf = Buffer.alloc(Math.min(CHUNK, end - at + 1));
        const { bytesRead } = await handle.read(buf, 0, buf.length, at);
        // A file that shrank while it played is not the indexed file.
        if (bytesRead === 0) throw new Error("short");
        c.enqueue(new Uint8Array(buf.subarray(0, bytesRead)));
        at += bytesRead;
      } catch {
        close();
        d.onFault(id);
        return c.error(new Error("file unavailable"));
      }
      if (at > end) {
        close();
        c.close();
      }
    },
    cancel() {
      close();
    },
  });
}

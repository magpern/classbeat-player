// The SHA-256 of a whole file the walk or the index named (ADR 0017 section 2). The file is opened
// without following a symbolic link where the system can refuse one and without hanging on a
// planted pipe, and it must still be a plain file of the expected size once open. It is read in
// chunks, so a cancelled find stops between two of them. Null for anything else, never an error
// that could carry the path.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

const CHUNK = 1 << 20;

export interface Hashed {
  readonly sha256: string;
  readonly mtimeMs: number;
}

/** The hash and modification time of the plain file at `path` of `size` bytes, or null. */
export async function hashFile(path: string, size: number, stopped: () => boolean): Promise<Hashed | null> {
  let handle: FileHandle;
  try {
    // O_NONBLOCK: a pipe planted in the file's place cannot hang the open; it is then not a file.
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size !== size) return null;
    const hash = createHash("sha256");
    const buf = Buffer.alloc(Math.min(CHUNK, size));
    let read = 0;
    while (read < size) {
      if (stopped()) return null;
      const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, size - read), read);
      if (bytesRead === 0) return null;
      hash.update(buf.subarray(0, bytesRead));
      read += bytesRead;
    }
    // A file that changed size while it was read is not the file of this size.
    const after = await handle.stat();
    if (after.size !== size || after.mtimeMs !== st.mtimeMs) return null;
    return { sha256: hash.digest("hex"), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

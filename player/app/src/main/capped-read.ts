// Reading a file of the app's own folder without trusting it: never more than a cap, never
// through a symbolic link where the system can refuse one, never hanging on a planted pipe.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

/**
 * The file's bytes, or null when it is not a plain file or is over `max`. The size is checked
 * before anything is read, a symbolic link is not followed where the system can refuse one (not
 * Windows, where only this user can write the folder), and
 * never more than `max` bytes are read, even if the file grows meanwhile.
 */
export function readCapped(file: string, max: number): Buffer | null {
  // O_NONBLOCK: a pipe planted in the file's place cannot hang the open; it is then not a file.
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (let got = -1; got !== 0 && n <= max; n += got) got = readSync(fd, buf, n, buf.length - n, null);
    return n > max ? null : buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

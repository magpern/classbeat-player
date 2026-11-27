// Walking the folders the instructor chose for files that could be a class's songs (ADR 0017
// section 2). Only a plain file whose size is one the class wants is a candidate; nothing is read
// from a file here. A symbolic link (and, on Windows, a junction, which reads as one) is never
// followed, a folder that cannot be read is skipped, and at most `budget.left` entries are looked
// at, shared by every folder of one find. Names from the disk are untrusted data: they are only
// joined into paths, never logged, answered or put in an error.
import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface Budget {
  /** Entries still allowed in this find; it goes down by one for each entry looked at. */
  left: number;
  /** Set once an entry was left unread because the budget ran out. */
  reached: boolean;
}

export interface Candidate {
  readonly path: string;
  readonly size: number;
}

/**
 * The plain files under `root` whose size is in `sizes`. Stops early when `stopped()` turns true.
 * Never throws for a folder or a file it cannot read.
 */
export async function candidates(root: string, sizes: ReadonlySet<number>, budget: Budget, stopped: () => boolean): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const pending = [root];
  while (pending.length > 0 && !stopped()) {
    const dir = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of entries) {
      if (stopped()) break;
      if (budget.left <= 0) {
        budget.reached = true;
        return out;
      }
      budget.left -= 1;
      if (d.isSymbolicLink()) continue;
      const path = join(dir, d.name);
      if (d.isDirectory()) pending.push(path);
      else if (d.isFile()) {
        try {
          const st = await lstat(path);
          if (st.isFile() && sizes.has(st.size)) out.push({ path, size: st.size });
        } catch {
          // Gone or unreadable meanwhile: not a candidate.
        }
      }
    }
  }
  return out;
}

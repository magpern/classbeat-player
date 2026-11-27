// The music files state of each local class on the class list (docs/design/music-files.md), kept in
// memory only. It asks `check` (the index and the folders already chosen, no dialog) for every local
// row the list shows, one at a time, and runs the instructor's "Find music files" through `find`,
// remembering the phase (`checking`, `choosing`, `finding`), whether a find ended with files still
// missing and whether it failed. What it hands the list is a `FilesView` (core/music-files/
// files-view.ts): per song `found` or `missing` turned into the class document's own words, never a
// path, a folder or a name from the disk. Nothing here logs. One operation runs at a time, as in
// the music files service; a second request while one runs does nothing.
import { FAILED } from "../../core/music-files/answer.ts";
import type { FindAnswer } from "../../core/music-files/answer.ts";
import { filesViewOf } from "../../core/music-files/files-view.ts";
import type { FilesPhase, FilesPort, FilesView } from "../../core/music-files/files-view.ts";
import type { ClassRow } from "../../core/sync/class-list.ts";
import type { MusicFiles } from "./service.ts";

export interface FilesStateDeps {
  readonly music: Pick<MusicFiles, "find" | "check" | "cancel">;
  /** The cached document of a class, or null. */
  readonly document: (id: string) => unknown;
  /** Monotonic ms. */
  readonly now: () => number;
}

export interface FilesState extends FilesPort {
  /** The instructor's "Find music files": the folder window, then the search. Null when something already runs. */
  find(classId: string): Promise<FindAnswer | null>;
  cancel(): boolean;
  /** The folder window was answered with a folder: the search begins (called by the music files service). */
  picked(): void;
}

/** A check that found the service busy is asked again after this long. */
export const RETRY_MS = 1000;

interface Entry {
  hash: string;
  answer: FindAnswer | null;
  phase: FilesPhase;
  searched: boolean;
  failed: boolean;
  retryAt: number;
  /** The view built from the entry as it is, or null when the entry changed since. */
  memo: FilesView | null;
}

export function createFilesState(d: FilesStateDeps): FilesState {
  const entries = new Map<string, Entry>();
  /** The class an operation runs for, or null. */
  let running: string | null = null;

  const entryOf = (r: Pick<ClassRow, "id" | "hash">): Entry => {
    let e = entries.get(r.id);
    if (e === undefined || e.hash !== r.hash) {
      e = { hash: r.hash, answer: null, phase: "idle", searched: false, failed: false, retryAt: 0, memo: null };
      entries.set(r.id, e);
    }
    return e;
  };
  const touch = (e: Entry, change: Partial<Omit<Entry, "memo">>): void => {
    Object.assign(e, change, { memo: null });
  };

  const check = (id: string, e: Entry): void => {
    running = id;
    touch(e, { phase: "checking" });
    const done = (a: FindAnswer | null): void => {
      if (running === id) running = null;
      // Busy or cancelled: nothing was learned; ask again soon.
      touch(e, { phase: "idle", ...(a === null || a.status === "cancelled" ? { retryAt: d.now() + RETRY_MS } : { answer: a }) });
    };
    void d.music.check(id).then(done, () => done(FAILED));
  };

  /** What the row says: its own operation, or "checking" while it has no answer yet. A class with an answer keeps it while another class runs. */
  const phaseOf = (e: Entry): FilesPhase => (e.phase === "idle" && e.answer === null ? "checking" : e.phase);
  /** Start waits for any check or find, so the page holds it exactly when the shell would refuse it (`held`, below). */
  const heldOf = (e: Entry): boolean => phaseOf(e) !== "idle" || running !== null;

  return {
    view(rows) {
      // Start the next automatic check before any row is projected, so every row's `held` is read after the shared flag is set.
      for (const r of rows) {
        const e = r.source === "local" ? entryOf(r) : null;
        if (e !== null && running === null && e.phase === "idle" && e.answer === null && d.now() >= e.retryAt) check(r.id, e);
      }
      const out: FilesView[] = [];
      for (const r of rows) {
        if (r.source !== "local") continue;
        const e = entryOf(r);
        if (e.memo === null || e.memo.phase !== phaseOf(e) || e.memo.held !== heldOf(e)) {
          e.memo = filesViewOf({
            id: r.id,
            hash: r.hash,
            doc: d.document(r.id),
            answer: e.answer,
            phase: phaseOf(e),
            held: heldOf(e),
            searched: e.searched,
            failed: e.failed,
          });
        }
        if (e.memo !== null) out.push(e.memo);
      }
      return out;
    },
    async find(classId) {
      const e = entries.get(classId);
      if (e === undefined || running !== null) return null;
      running = classId;
      touch(e, { phase: "choosing", failed: false });
      let a: FindAnswer | null;
      try {
        a = await d.music.find(classId);
      } catch {
        a = FAILED;
      }
      if (running === classId) running = null;
      if (a === null) {
        touch(e, { phase: "idle" });
        return null;
      }
      if (a.status === "done") {
        // The index changed: every other class's answer is asked again.
        for (const [id, other] of entries) if (id !== classId) touch(other, { answer: null, retryAt: 0 });
        touch(e, { phase: "idle", answer: a, searched: a.songs.some((s) => s !== "found"), failed: false });
      } else if (a.status === "failed") touch(e, { phase: "idle", failed: true });
      else touch(e, { phase: "idle" });
      return a;
    },
    cancel: () => d.music.cancel(),
    picked() {
      const e = running === null ? undefined : entries.get(running);
      if (e !== undefined && e.phase === "choosing") touch(e, { phase: "finding" });
    },
    held(classId, hash) {
      // Also while another class's check runs: the check at Start would find the service busy and call it "not checked".
      const e = entries.get(classId);
      return e === undefined || e.hash !== hash ? running !== null : heldOf(e);
    },
    reset() {
      for (const e of entries.values()) touch(e, { answer: null, retryAt: 0, searched: false, failed: false });
    },
  };
}

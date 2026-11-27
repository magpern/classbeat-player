// Finding a class's songs among the instructor's own files (ADR 0017 section 2; owner's settlement
// on #920). One find or check runs at a time. A find asks for a folder (the operating system's
// dialog, in the main process), checks the index again and searches that folder; a check before
// playing searches the folders already chosen. The answer is per song `found` or `missing` and
// whether the file limit was reached: never a path, a folder, a name from the disk, a hash or a
// count. A cancelled find answers `cancelled` and keeps nothing; any fault answers `failed`, with
// no reason. The index is kept only when the find ran to its end for the same, still paired
// account. Nothing here logs.
import { CANCELLED, FAILED, MAX_FILES, doneAnswer } from "../../core/music-files/answer.ts";
import type { FindAnswer } from "../../core/music-files/answer.ts";
import { rememberFolder, sameIndex } from "../../core/music-files/index-model.ts";
import type { IndexedFile, MusicIndex } from "../../core/music-files/index-model.ts";
import { wantedFiles } from "../../core/music-files/wanted.ts";
import type { WantedFile } from "../../core/music-files/wanted.ts";
import { matchFiles } from "./matcher.ts";
import type { IndexStore } from "./index-store.ts";

export interface MusicFilesDeps {
  /** The paired account's opaque key, or null when not paired. */
  account(): string | null;
  /** The class list's document of the class, or null when the list would not show it. */
  classDocument(id: string): unknown;
  /** The folder the instructor chose in the operating system's dialog, or null. */
  pickFolder(): Promise<string | null>;
  store: IndexStore;
  /** The entry limit of one find; MAX_FILES unless a test sets a smaller one. */
  maxFiles?: number;
}

export interface MusicFiles {
  /** Null when a find or a check is already running: the second one does nothing. */
  find(classId: string): Promise<FindAnswer | null>;
  /** The check before playing: the index and the folders chosen, with no dialog. Null when busy. */
  check(classId: string): Promise<FindAnswer | null>;
  /** The same check for the open class's document, from the controller (a class opened from a file is in no list). */
  checkOpen(doc: unknown): Promise<FindAnswer | null>;
  /** The account's indexed file of this hash, as the last find or check left it, or null: for the `cbp-local:` scheme only. */
  indexed(account: string, sha256: string): IndexedFile | null;
  /** Stops the find or check running; false when none was. */
  cancel(): boolean;
  /**
   * The class cache is being wiped (main/sync/service.ts `onWipe`, every cause): whatever runs is
   * stopped and keeps nothing, and every account's index is deleted with the cache.
   */
  wipe(): void;
}

interface Run {
  stopped: boolean;
}

export function createMusicFiles(d: MusicFilesDeps): MusicFiles {
  let current: Run | null = null;
  let generation = 0;
  const limit = d.maxFiles ?? MAX_FILES;

  /** Runs `body` alone, or answers null while another run is going. */
  const exclusive = async (body: (run: Run, gen: number) => Promise<FindAnswer>): Promise<FindAnswer | null> => {
    if (current !== null) return null;
    const run: Run = { stopped: false };
    current = run;
    try {
      return await body(run, generation);
    } catch {
      return FAILED;
    } finally {
      if (current === run) current = null;
    }
  };

  /** Matches and keeps the index, unless the run was stopped or the pairing changed meanwhile. */
  const match = async (run: Run, gen: number, account: string, wanted: readonly WantedFile[] | null, index: (loaded: MusicIndex) => MusicIndex, folders: (i: MusicIndex) => readonly string[]): Promise<FindAnswer> => {
    if (wanted === null) return FAILED;
    const before = index(d.store.load(account));
    const stillOurs = (): boolean => !run.stopped && gen === generation && d.account() === account;
    const m = await matchFiles(wanted, before, folders(before), limit, () => !stillOurs());
    // matchFiles checks `stillOurs` last, with no wait after it: null is the only stopped outcome.
    if (m === null) return CANCELLED;
    // An index that could not be written leaves the answer true for now; the next find searches again.
    if (!sameIndex(before, m.index)) d.store.save(account, m.index);
    return doneAnswer(wanted, m.found, m.limitReached);
  };

  const checkWanted = (wanted: () => readonly WantedFile[] | null): Promise<FindAnswer | null> =>
    exclusive(async (run, gen) => {
      const account = d.account();
      if (account === null) return FAILED;
      return match(run, gen, account, wanted(), (i) => i, (i) => i.folders);
    });

  return {
    find: (classId) =>
      exclusive(async (run, gen) => {
        const account = d.account();
        if (account === null || wantedFiles(d.classDocument(classId)) === null) return FAILED;
        const folder = await d.pickFolder();
        if (folder === null || run.stopped || gen !== generation) return CANCELLED;
        return match(run, gen, account, wantedFiles(d.classDocument(classId)), (i) => rememberFolder(i, folder), () => [folder]);
      }),
    check: (classId) => checkWanted(() => wantedFiles(d.classDocument(classId))),
    checkOpen: (doc) => checkWanted(() => wantedFiles(doc)),
    indexed(account, sha256) {
      try {
        return d.store.load(account).files.get(sha256) ?? null;
      } catch {
        return null;
      }
    },
    cancel() {
      if (current === null || current.stopped) return false;
      current.stopped = true;
      return true;
    },
    wipe() {
      if (current !== null) current.stopped = true;
      generation += 1;
      d.store.wipe();
    },
  };
}

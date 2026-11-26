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
import type { MusicIndex } from "../../core/music-files/index-model.ts";
import { wantedFiles } from "../../core/music-files/wanted.ts";
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
  /** Stops the find or check running; false when none was. */
  cancel(): boolean;
  /** The pairing ended: whatever runs is stopped and keeps nothing, and every index is deleted. */
  forgotten(): void;
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
  const match = async (run: Run, gen: number, account: string, classId: string, index: (loaded: MusicIndex) => MusicIndex, folders: (i: MusicIndex) => readonly string[]): Promise<FindAnswer> => {
    const wanted = wantedFiles(d.classDocument(classId));
    if (wanted === null) return FAILED;
    const before = index(d.store.load(account));
    const stillOurs = (): boolean => !run.stopped && gen === generation && d.account() === account;
    const m = await matchFiles(wanted, before, folders(before), limit, () => !stillOurs());
    if (m === null || !stillOurs()) return CANCELLED;
    // An index that could not be written leaves the answer true for now; the next find searches again.
    if (!sameIndex(before, m.index)) d.store.save(account, m.index);
    return doneAnswer(wanted, m.found, m.limitReached);
  };

  return {
    find: (classId) =>
      exclusive(async (run, gen) => {
        const account = d.account();
        if (account === null || wantedFiles(d.classDocument(classId)) === null) return FAILED;
        const folder = await d.pickFolder();
        if (folder === null || run.stopped || gen !== generation) return CANCELLED;
        return match(run, gen, account, classId, (i) => rememberFolder(i, folder), () => [folder]);
      }),
    check: (classId) =>
      exclusive(async (run, gen) => {
        const account = d.account();
        if (account === null) return FAILED;
        return match(run, gen, account, classId, (i) => i, (i) => i.folders);
      }),
    cancel() {
      if (current === null || current.stopped) return false;
      current.stopped = true;
      return true;
    },
    forgotten() {
      if (current !== null) current.stopped = true;
      generation += 1;
      d.store.wipe();
    },
  };
}

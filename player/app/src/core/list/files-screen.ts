// The words and keys of the instructor's music files state on the class list (docs/design/
// music-files.md, "States"), from one class's `FilesView`. Pure. Each state is read from the per-song
// answer and the phase alone: the screens never name a path, a folder or a file from the disk, and
// the only file name is the class document's own (the missing list). Sentence case, no full stop on
// a line or a key; the plate's and the detail's whole sentences keep theirs.
import type { FilesView, MissingSong } from "../music-files/files-view.ts";
import type { RowMix } from "../mix/list-model.ts";
import type { Button, Marker, Plate } from "./states.ts";

export interface FilesLine {
  readonly marker: Marker;
  readonly text: string;
  /** The grey line under it; null while a plate is shown (the footer drops it). */
  readonly detail: string | null;
  /** "Show which files": only while a file is missing; held (shown, disabled) while a check runs. */
  readonly show: Button | null;
  /** "Find music files": only while a file is missing or a search runs; held while any check or search runs. */
  readonly find: Button | null;
  /** Start waits for the answer, or for another class's check or search. */
  readonly startHeld: boolean;
}

export interface FilesList {
  readonly heading: string;
  readonly sentence: string;
  readonly songs: readonly MissingSong[];
  readonly buttons: readonly Button[];
  readonly fine: string;
}

const START = "Starting opens the room screen and the presenter window";
const btn = (id: Button["id"], label: string, key: string | null, primary: boolean, held = false): Button => ({ id, label, key, primary, ...(held ? { held } : {}) });

const files = (n: number): string => `${n} music ${n === 1 ? "file" : "files"}`;
const busy = (v: FilesView): boolean => v.phase !== "idle";
const missingOf = (v: FilesView): number => v.missing.length;

function lineOf(v: FilesView): FilesLine {
  const m = missingOf(v);
  const find = (held: boolean): Button => btn("files-find", "Find music files", null, false, held);
  if (v.phase === "choosing") return { marker: "work", text: "Choose the folder with your music", detail: "A window from this computer is open. Starting waits until you have chosen", show: null, find: find(true), startHeld: true };
  // A check the player runs by itself: no folder was chosen, so the words do not speak of one.
  if (v.phase === "checking") return { marker: "work", text: "Finding music files…", detail: "Looking for them on this computer. Starting waits until this is done", show: btn("files-show", "Show which files", null, false, true), find: find(true), startHeld: true };
  if (busy(v)) return { marker: "work", text: "Finding music files…", detail: "Looking in the folder you chose and the folders inside it. Starting waits until this is done", show: null, find: find(true), startHeld: true };
  if (m === 0) {
    const one = v.total === 1;
    return { marker: "ok", text: one ? "The music file is found" : `All ${v.total} music files are found`, detail: `Starting plays ${one ? "it" : "them"} from this computer and opens the room screen and the presenter window`, show: null, find: null, startHeld: v.held };
  }
  const all = m === v.total && v.total > 1;
  const words = v.searched ? (all ? `All ${v.total} music files are still missing` : `${files(m)} ${m === 1 ? "is" : "are"} still missing`) : all ? `All ${v.total} music files are missing` : `${files(m)} ${m === 1 ? "is" : "are"} missing`;
  const detail = v.searched ? `${m === 1 ? "It was" : "They were"} not in the folder you chose. Choose another folder, or start on the manual clock` : `${START}. Manual clock until ${m === 1 ? "it is" : "they are"} found`;
  return { marker: "away", text: words, detail, show: btn("files-show", "Show which files", null, false), find: find(v.held), startHeld: v.held };
}

/** The files line of the selected local class's footer; it drops its grey line while the failure plate is shown, so five rows stay whole. */
export function filesLineOf(v: FilesView): FilesLine {
  const line = lineOf(v);
  return v.failed && !busy(v) ? { ...line, detail: null } : line;
}

/** A row's second-line marker and words: "Files found", "2 files missing", "Finding files…". */
export function rowFilesOf(v: FilesView): RowMix {
  if (busy(v)) return { marker: "work", text: "Finding files…" };
  const m = missingOf(v);
  return m === 0 ? { marker: "ok", text: "Files found" } : { marker: "away", text: `${m} ${m === 1 ? "file" : "files"} missing` };
}

/** The plate above the list after a search that failed; null otherwise. */
export function filesPlateOf(v: FilesView | null): Plate | null {
  if (v === null || !v.failed || busy(v)) return null;
  return { headline: "The music files could not be searched", detail: "Nothing was changed. Try again, or start on the manual clock.", lines: [], button: btn("files-find", "Try again", null, false) };
}

/** The panel of the missing songs, in place of the list; null when no song is missing. */
export function filesListOf(title: string, v: FilesView): FilesList | null {
  const m = missingOf(v);
  if (m === 0) return null;
  return {
    heading: "Missing music files",
    sentence: `${title}: ${m} of ${v.total} music files ${m === 1 ? "is" : "are"} not found on this computer.`,
    songs: v.missing,
    buttons: [btn("files-find", "Find music files", "Enter", true, v.held), btn("files-back", "Back", "Esc", false)],
    fine: "Files are matched by their content, not by name. Nothing leaves this computer.",
  };
}

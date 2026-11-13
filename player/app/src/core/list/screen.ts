// The class list as the window paints it (docs/design/class-list.md): everything the screen says,
// as plain data, from what the shell sent and what the window holds (the filter and the
// selection). Pure: the clock is an argument, and nothing here touches the page.
import { clockText } from "../format.ts";
import { updatedText } from "../sync/updated-text.ts";
import { filterRows, FILTER_FROM } from "./filter.ts";
import type { ListRow } from "./rows.ts";
import { keepSelection } from "./selection.ts";
import { FIRST_SYNC, headOf, NO_CLASSES, NO_MATCH } from "./states.ts";
import type { Button, Panel, Plate, StatusLine } from "./states.ts";
import type { ListUi, ListView } from "./view.ts";

export interface RowModel {
  readonly id: string;
  readonly hash: string;
  readonly title: string;
  /** "Spotify, 11 songs", "Manual clock, no music". */
  readonly meta: string;
  readonly length: string;
  readonly updated: string | null;
  /** Outlined tags, in words: "Playing now", "Newer version after this class", ... */
  readonly tags: readonly string[];
  readonly selected: boolean;
  /** Greyed and not startable: another class is being played. */
  readonly dim: boolean;
}

export interface Footer {
  readonly title: string;
  readonly detail: string;
  readonly button: Button;
  /** What Enter or the button does. */
  readonly action: "start" | "back";
  /** The row the footer is about. */
  readonly id: string;
}

export interface FilterModel {
  /** "3 of 42" once text is typed, else null. */
  readonly of: string | null;
}

export type Body =
  | { readonly kind: "list"; readonly rows: readonly RowModel[]; readonly footer: Footer }
  | { readonly kind: "panel"; readonly panel: Panel };

export interface Screen {
  readonly count: string | null;
  readonly status: StatusLine | null;
  readonly plate: Plate | null;
  /** The second plate: a class file that did not open. */
  readonly filePlate: Plate | null;
  /** Null: no filter (fewer than eight classes, or no list). */
  readonly filter: FilterModel | null;
  readonly body: Body;
  readonly selectedId: string | null;
  /** The one line a screen reader says when it changes. */
  readonly announce: string;
}

const SOURCE: Readonly<Record<ListRow["source"], string>> = { spotify: "Spotify", swedebeat: "Swedebeat", none: "" };

export function metaText(r: Pick<ListRow, "sport" | "source" | "songs">): string {
  const music = r.source === "none" ? "Manual clock, no music" : `${SOURCE[r.source]}, ${r.songs} ${r.songs === 1 ? "song" : "songs"}`;
  return r.sport === "running" ? `Running, ${music}` : music;
}

function tagsOf(r: ListRow): string[] {
  return [...(r.playing ? ["Playing now"] : []), ...(r.removed ? ["Removed: plays to the end"] : []), ...(r.newer ? ["Newer version after this class"] : []), ...(r.notUpdated ? ["Could not be updated: older copy shown"] : [])];
}

function footerOf(r: ListRow | undefined, pinned: boolean): Footer | null {
  if (r === undefined) return null;
  return pinned
    ? { title: r.title, detail: "Other classes can start when this one has ended", button: { id: "open-file", label: "Back to the class", key: "Enter", primary: true }, action: "back", id: r.id }
    : { title: r.title, detail: "Starting opens the room screen and the presenter window", button: { id: "open-file", label: "Start class", key: "Enter", primary: true }, action: "start", id: r.id };
}

const countText = (n: number): string => (n === 1 ? "1 class" : `${n} classes`);

export function screenOf(v: ListView, ui: ListUi, now: number): Screen {
  const head = headOf(v);
  // The filter is there from eight classes; while a file's error plate is up it steps aside, so that a whole screen of rows stays in view.
  const allowed = v.rows.length >= FILTER_FROM && v.fileError === null;
  const filterText = allowed ? ui.filter : "";
  const shown = filterRows(v.rows, filterText);
  const playingRow = v.rows.find((r) => r.playing);
  const pinned = playingRow !== undefined;
  const selectedId = keepSelection(shown.map((r) => r.id), ui.selectedId, playingRow?.id ?? null, ui.lastStartedId);

  let body: Body;
  let withFilter = false;
  if (head.panel !== null) {
    body = { kind: "panel", panel: head.panel };
  } else if (v.rows.length === 0) {
    body = { kind: "panel", panel: v.sync.status === "syncing" || v.sync.status === "unpaired" ? FIRST_SYNC : NO_CLASSES };
  } else {
    withFilter = allowed;
    const footer = footerOf(pinned ? playingRow : shown.find((r) => r.id === selectedId), pinned);
    if (shown.length === 0 || footer === null) {
      body = { kind: "panel", panel: NO_MATCH(filterText.trim()) };
    } else {
      const rows = shown.map((r): RowModel => ({
        id: r.id,
        hash: r.hash,
        title: r.title,
        meta: metaText(r),
        length: clockText(r.lengthMs),
        updated: updatedText(r.updated, now),
        tags: tagsOf(r),
        selected: r.id === selectedId,
        dim: pinned && !r.playing,
      }));
      body = { kind: "list", rows, footer };
    }
  }

  const cached = v.rows.filter((r) => !r.removed).length;
  const filePlate: Plate | null =
    v.fileError === null
      ? null
      : { headline: v.fileError.message, detail: `${v.fileError.fileName} was not opened.`, lines: v.fileError.details.slice(0, 5), button: { id: "close", label: "Close", key: "Esc", primary: false } };
  return {
    count: head.counted ? countText(cached) : null,
    status: head.status,
    plate: head.plate,
    filePlate,
    filter: withFilter ? { of: filterText.trim() === "" ? null : `${shown.length} of ${v.rows.length}` } : null,
    body,
    selectedId,
    announce: head.status?.text ?? head.plate?.headline ?? "",
  };
}

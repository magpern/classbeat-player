// The class list as the window paints it (docs/design/class-list.md): everything the screen says,
// as plain data, from what the shell sent and what the window holds (the filter and the
// selection). Pure: the clock is an argument, and nothing here touches the page.
import { clockText } from "../format.ts";
import { footerReason, mixHeadOf, rowMixOf } from "../mix/list-model.ts";
import type { MixForm, MixHead, MixLine, MixPlate, RowMix } from "../mix/list-model.ts";
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
  /** A Swedebeat row's mix words, or null. */
  readonly mix: RowMix | null;
}

export interface Footer {
  readonly title: string;
  readonly detail: string;
  readonly button: Button;
  /** What Enter or the button does. */
  readonly action: "start" | "back";
  /** The button is shown but cannot be used: the class needs a newer player. */
  readonly disabled: boolean;
  /** The id of the footer detail the disabled button points at (aria-describedby), or null. */
  readonly describedBy: typeof FOOT_DETAIL_ID | null;
  /** The row the footer is about. */
  readonly id: string;
}

export interface FilterModel {
  /** "3 of 42" once text is typed, else null. */
  readonly of: string | null;
}

export type Body =
  | { readonly kind: "list"; readonly rows: readonly RowModel[]; readonly footer: Footer }
  | { readonly kind: "panel"; readonly panel: Panel }
  | { readonly kind: "mix-form"; readonly form: MixForm };

export interface Screen {
  readonly count: string | null;
  readonly status: StatusLine | null;
  readonly plate: Plate | null;
  /** The second plate: a class file that did not open. */
  readonly filePlate: Plate | null;
  /** The Swedebeat line, or its plate in its place (docs/design/swedebeat.md). */
  readonly mixLine: MixLine | null;
  readonly mixPlate: MixPlate | null;
  /** Null: no filter (fewer than eight classes, or no list). */
  readonly filter: FilterModel | null;
  readonly body: Body;
  readonly selectedId: string | null;
  /** The one line a screen reader says when it changes. */
  readonly announce: string;
}

/** The id the renderer gives the footer detail line. */
export const FOOT_DETAIL_ID = "foot-detail";
export const NEEDS_NEWER_PLAYER = "This class needs a newer version of the player";
const SOURCE: Readonly<Record<ListRow["source"], string>> = { spotify: "Spotify", swedebeat: "Swedebeat", none: "", unknown: "" };

export function metaText(r: Pick<ListRow, "sport" | "source" | "songs">): string {
  if (r.source === "unknown") return NEEDS_NEWER_PLAYER;
  const music = r.source === "none" ? "Manual clock, no music" : `${SOURCE[r.source]}, ${r.songs} ${r.songs === 1 ? "song" : "songs"}`;
  return r.sport === "running" ? `Running, ${music}` : music;
}

function tagsOf(r: ListRow): string[] {
  return [...(r.playing ? ["Playing now"] : []), ...(r.removed ? ["Removed: plays to the end"] : []), ...(r.newer ? ["Newer version after this class"] : []), ...(r.notUpdated ? ["Could not be updated: older copy shown"] : [])];
}

const START = "Starting opens the room screen and the presenter window";

/** `reason`: the end of the line for a Swedebeat class that plays on the manual clock. */
function footerOf(r: ListRow | undefined, pinned: boolean, reason: string | null): Footer | null {
  if (r === undefined) return null;
  const detail = r.source === "unknown" ? NEEDS_NEWER_PLAYER : r.source === "swedebeat" && reason !== null ? `${START}. ${reason}` : START;
  return pinned
    ? { title: r.title, detail: "Other classes can start when this one has ended", button: { id: "open-file", label: "Back to the class", key: "Enter", primary: true }, action: "back", disabled: false, describedBy: null, id: r.id }
    : { title: r.title, detail, button: { id: "open-file", label: "Start class", key: "Enter", primary: true }, action: "start", disabled: r.source === "unknown", describedBy: r.source === "unknown" ? FOOT_DETAIL_ID : null, id: r.id };
}

const NO_MIX: MixHead = { line: null, plate: null, panel: null, form: null };

const countText = (n: number): string => (n === 1 ? "1 class" : `${n} classes`);

export function screenOf(v: ListView, ui: ListUi, now: number): Screen {
  const head = headOf(v);
  // Swedebeat only on a paired list that is shown (a state with a panel of its own comes first).
  const mix = head.panel === null ? mixHeadOf(v.mix, ui.mix ?? "none", v.rows.some((r) => r.source === "swedebeat"), ui.mixNote ?? null) : NO_MIX;
  // The filter is there from eight classes. It steps aside only for a file's error plate or a form's note (the form takes the body); under a Swedebeat fault plate it stays (#724).
  const allowed = v.rows.length >= FILTER_FROM && v.fileError === null && mix.form === null;
  const filterText = allowed ? ui.filter : "";
  const shown = filterRows(v.rows, filterText);
  const playingRow = v.rows.find((r) => r.playing);
  const pinned = playingRow !== undefined;
  const selectedId = keepSelection(shown.map((r) => r.id), ui.selectedId, playingRow?.id ?? null, ui.lastStartedId);

  const rowMix = rowMixOf(v.mix);

  let body: Body;
  let withFilter = false;
  if (head.panel !== null) {
    body = { kind: "panel", panel: head.panel };
  } else if (mix.form !== null) {
    body = { kind: "mix-form", form: mix.form };
  } else if (mix.panel !== null) {
    body = { kind: "panel", panel: mix.panel };
  } else if (v.rows.length === 0) {
    body = { kind: "panel", panel: v.sync.status === "syncing" || v.sync.status === "unpaired" ? FIRST_SYNC : NO_CLASSES };
  } else {
    withFilter = allowed;
    const footer = footerOf(pinned ? playingRow : shown.find((r) => r.id === selectedId), pinned, footerReason(v.mix));
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
        mix: r.source === "swedebeat" ? rowMix : null,
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
    mixLine: mix.line,
    mixPlate: mix.plate,
    filter: withFilter ? { of: filterText.trim() === "" ? null : `${shown.length} of ${v.rows.length}` } : null,
    body,
    selectedId,
    announce: mix.plate?.headline ?? head.status?.text ?? head.plate?.headline ?? "",
  };
}

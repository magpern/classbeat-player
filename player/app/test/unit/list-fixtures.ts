// Views of the class list for the tests of its pure model, and the same fixtures the screenshot
// run uses (test/shots/states.ts). Plain data; no network, no real account.
import type { ListRow } from "../../src/core/list/rows.ts";
import type { ListView } from "../../src/core/list/view.ts";
import type { PairingView } from "../../src/core/pairing/view.ts";
import type { SyncView } from "../../src/core/sync/view.ts";

export const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

const uuid = (n: number): string => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

/** A row; the id and the hash come from the title's place in the list of titles made so far. */
export function row(title: string, n: number, over: Partial<ListRow> = {}): ListRow {
  return {
    id: uuid(n),
    hash: `sha256:${String(n).padStart(64, "0")}`,
    title,
    lengthMs: 45 * 60_000,
    sport: "cycling",
    source: "spotify",
    songs: 12,
    updated: "2026-11-09T09:00:00+00:00",
    playing: false,
    newer: false,
    notUpdated: false,
    removed: false,
    ...over,
  };
}

export const rows = (titles: readonly string[]): ListRow[] => titles.map((t, i) => row(t, i + 1));

export const PAIRED: Extract<PairingView, { state: "paired" }> = { state: "paired", email: "ana@example.com", deviceName: "Studio PC", pairAgain: false };
export const SYNCED: SyncView = { status: "synced", unavailable: null, wiping: false, classes: 0, notUpdated: [], pinned: null };

export function view(over: Omit<Partial<ListView>, "sync"> & { sync?: Partial<SyncView> } = {}): ListView {
  const { sync, ...rest } = over;
  return { sync: { ...SYNCED, ...sync }, pairing: PAIRED, rows: [], fileError: null, ...rest };
}

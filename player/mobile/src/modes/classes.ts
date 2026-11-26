// The class list's data from native code (issue #631): listClasses and syncNow answer
// {classes: [{id, title, minutes, songs}], status}. Read strictly: an answer of any other shape is
// "unexpected" and shows nothing new, never a guess. Pure: no DOM, no bridge. The words of each
// status follow docs/design/class-list.md, "States".

export type Status = "syncing" | "synced" | "offline" | "waiting" | "expired" | "unpaired" | "unavailable";

export interface ClassRow {
  readonly id: string;
  readonly title: string;
  readonly facts: string;
}

export interface ClassList {
  readonly classes: readonly ClassRow[];
  readonly status: Status;
}

/** The status line, or a plate (head, detail) for the states class-list.md shows as one. */
export const STATUS_WORDS: Readonly<Record<Status, { readonly line: string; readonly plate?: string }>> = {
  syncing: { line: "Syncing" },
  synced: { line: "Up to date" },
  offline: { line: "Offline" },
  waiting: { line: "Sync is waiting" },
  expired: { line: "The pairing has run out", plate: "Pair again to get new and changed classes. Saved classes still play." },
  unpaired: { line: "Not paired" },
  unavailable: { line: "The saved classes could not be read", plate: "They are still on this phone. Trying again soon." },
};

export const PAIR_AGAIN = "Pair again";
export const UNPAIR = "Unpair this phone";

const STATUSES = Object.keys(STATUS_WORDS) as Status[];
/** A class id as native code checks it (Calls.isClassId): a lower-case UUID. */
export const CLASS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The list from listClasses or syncNow, or null when the answer is not exactly that shape. */
export function parseClassList(reply: unknown): ClassList | null {
  const o = exactly(reply, ["classes", "status"]);
  if (o === null || !Array.isArray(o.classes)) return null;
  const status = STATUSES.find((s) => s === o.status);
  if (status === undefined) return null;
  const classes: ClassRow[] = [];
  for (const item of o.classes) {
    const c = exactly(item, ["id", "title", "minutes", "songs"]);
    if (c === null || typeof c.id !== "string" || !CLASS_ID.test(c.id) || typeof c.title !== "string" || c.title === "") return null;
    if (!count(c.minutes) || !count(c.songs)) return null;
    classes.push({ id: c.id, title: c.title, facts: facts(c.minutes, c.songs) });
  }
  return { classes, status };
}

/** "45 min · 11 songs": the length and song count, as the row's second line. */
export function facts(minutes: number, songs: number): string {
  return `${minutes} min · ${songs} ${songs === 1 ? "song" : "songs"}`;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The object when its own keys are exactly [keys], else null. */
function exactly(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const own = Object.keys(v).sort();
  const want = [...keys].sort();
  return own.length === want.length && own.every((k, i) => k === want[i]) ? (v as Record<string, unknown>) : null;
}

// SPIKE ONLY class shape (not the class format; that is PL1). Pure: no I/O.

export interface ClassSong {
  trackId: string | null;
  title: string;
  artist: string;
  durationMs: number;
}

export interface PlanSong extends ClassSong {
  index: number;
  /** Class time at which this song's window starts. */
  startMs: number;
  /** Class time at which this song's window ends (the next song's start). */
  endMs: number;
}

export interface Plan {
  name: string;
  crossfadeMs: number;
  songs: PlanSong[];
  totalMs: number;
}

function fail(msg: string): never {
  throw new Error(`class file: ${msg}`);
}

/** Validate the spike class file and compute each song's window of class time. */
export function buildPlan(raw: unknown): Plan {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") fail("not an object");
  const crossfadeMs = o["crossfadeMs"];
  if (typeof crossfadeMs !== "number" || crossfadeMs < 0) fail("crossfadeMs must be a number >= 0");
  const list = o["songs"];
  if (!Array.isArray(list) || list.length === 0) fail("songs must be a non-empty array");
  const songs: PlanSong[] = [];
  let start = 0;
  list.forEach((s: Record<string, unknown>, index: number) => {
    if (typeof s["title"] !== "string" || typeof s["artist"] !== "string") fail(`song ${index}: title and artist are required`);
    const durationMs = s["durationMs"];
    if (typeof durationMs !== "number" || durationMs <= crossfadeMs) fail(`song ${index}: durationMs must exceed the crossfade`);
    const trackId = typeof s["trackId"] === "string" ? s["trackId"] : null;
    const isLast = index === list.length - 1;
    const endMs = isLast ? start + durationMs : start + durationMs - crossfadeMs;
    songs.push({ index, trackId, title: s["title"] as string, artist: s["artist"] as string, durationMs, startMs: start, endMs });
    start = endMs;
  });
  const name = typeof o["name"] === "string" ? o["name"] : "unnamed";
  return { name, crossfadeMs, songs, totalMs: start };
}

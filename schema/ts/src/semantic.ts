// Semantic rules of ADR 0003 section 4 that JSON Schema cannot express.
// Pure: takes a document that already passed the schema, returns violations. No I/O.
// Twin of python/src/classformat/semantic.py; both return the same (code, pointer) pairs.

export type Violation = readonly [code: string, pointer: string];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = any;

const RUNNING_MAX_ZONE = 5;

function checkIntervals(doc: Doc, out: Violation[]): void {
  let expected = 0;
  doc.intervals.forEach((iv: Doc, i: number) => {
    if (i === 0 && iv.start_ms !== 0) {
      out.push(["intervals_start_not_zero", "/intervals/0/start_ms"]);
    } else if (i > 0 && iv.start_ms !== expected) {
      out.push(["intervals_gap_or_overlap", `/intervals/${i}/start_ms`]);
    }
    expected = iv.start_ms + iv.length_ms;
  });
  if (expected !== doc.class.length_ms) out.push(["intervals_end_mismatch", "/intervals"]);
}

function checkPoints(points: Doc[], length: number, base: string, kind: string, out: Violation[]): void {
  let previous = -1;
  points.forEach((p, j) => {
    if (p.at_ms >= length) out.push([`${kind}_outside_song`, `${base}/${j}/at_ms`]);
    if (p.at_ms <= previous) out.push([`${kind}_unordered`, `${base}/${j}/at_ms`]);
    previous = p.at_ms;
  });
}

function checkSongs(doc: Doc, out: Violation[]): void {
  const songs: Doc[] = doc.songs;
  songs.forEach((s, i) => {
    const base = `/songs/${i}`;
    if (i === 0 && s.start_ms !== 0) out.push(["songs_first_start_not_zero", `${base}/start_ms`]);
    if (i > 0 && s.start_ms !== songs[i - 1].end_ms) {
      out.push(["songs_not_contiguous", `${base}/start_ms`]);
    }
    if (s.end_ms <= s.start_ms) {
      out.push(["song_window_empty", `${base}/end_ms`]);
    } else if (s.end_ms - s.start_ms > s.length_ms) {
      out.push(["song_window_longer_than_song", `${base}/end_ms`]);
    }
    if (s.beat_anchors) {
      checkPoints(s.beat_anchors.anchors, s.length_ms, `${base}/beat_anchors/anchors`, "anchor", out);
    }
    if (s.moments) checkPoints(s.moments.items, s.length_ms, `${base}/moments/items`, "moment", out);
  });
  if (songs.length > 0 && songs[songs.length - 1].end_ms !== doc.class.length_ms) {
    out.push(["songs_last_end_mismatch", `/songs/${songs.length - 1}/end_ms`]);
  }
}

function checkSegments(doc: Doc, out: Violation[]): void {
  const starts = new Set<number>(doc.intervals.map((iv: Doc) => iv.start_ms));
  const ends = new Set<number>(doc.intervals.map((iv: Doc) => iv.start_ms + iv.length_ms));
  let previousEnd = 0;
  ((doc.segments ?? []) as Doc[]).forEach((seg, i) => {
    const base = `/segments/${i}`;
    if (seg.end_ms <= seg.start_ms) out.push(["segment_empty", `${base}/end_ms`]);
    if (seg.start_ms < previousEnd) out.push(["segments_overlap_or_unordered", `${base}/start_ms`]);
    if (!starts.has(seg.start_ms)) out.push(["segment_not_on_interval_boundary", `${base}/start_ms`]);
    if (!ends.has(seg.end_ms)) out.push(["segment_not_on_interval_boundary", `${base}/end_ms`]);
    previousEnd = Math.max(previousEnd, seg.end_ms);
  });
}

function checkZones(doc: Doc, out: Violation[]): void {
  const running = doc.class.sport === "running";
  const seen = new Set<number>();
  doc.zone_scale.forEach((z: Doc, i: number) => {
    if (seen.has(z.zone)) out.push(["zone_duplicate", `/zone_scale/${i}/zone`]);
    seen.add(z.zone);
    if (running && z.zone > RUNNING_MAX_ZONE) {
      out.push(["zone_out_of_range_for_sport", `/zone_scale/${i}/zone`]);
    }
    for (const key of ["ftp_pct", "hrmax_pct", "rpe"]) {
      if (z[key] && z[key][0] > z[key][1]) out.push(["range_inverted", `/zone_scale/${i}/${key}`]);
    }
  });
  doc.intervals.forEach((iv: Doc, i: number) => {
    if (!seen.has(iv.zone)) out.push(["zone_not_in_scale", `/intervals/${i}/zone`]);
    const c = iv.cadence;
    if (c !== undefined && typeof c === "object" && c.from > c.to) {
      out.push(["range_inverted", `/intervals/${i}/cadence`]);
    }
  });
}

function checkTotals(doc: Doc, out: Violation[]): void {
  const totals = doc.totals;
  if (totals.length_ms !== doc.class.length_ms) out.push(["totals_length_mismatch", "/totals/length_ms"]);
  const scale = new Set<number>(doc.zone_scale.map((z: Doc) => z.zone));
  const keys = new Set<number>(Object.keys(totals.time_in_zone_ms).map(Number));
  const same = keys.size === scale.size && [...keys].every((k) => scale.has(k));
  if (!same) {
    out.push(["totals_zone_keys_mismatch", "/totals/time_in_zone_ms"]);
    return;
  }
  const sums = new Map<number, number>([...scale].map((z) => [z, 0]));
  for (const iv of doc.intervals as Doc[]) {
    if (sums.has(iv.zone)) sums.set(iv.zone, (sums.get(iv.zone) as number) + iv.length_ms);
  }
  for (const [key, value] of Object.entries(totals.time_in_zone_ms)) {
    if (sums.get(Number(key)) !== value) out.push(["totals_time_mismatch", `/totals/time_in_zone_ms/${key}`]);
  }
}

/** Every semantic violation of a schema-valid class document, sorted. */
export function checkSemantics(doc: unknown): Violation[] {
  const out: Violation[] = [];
  checkIntervals(doc, out);
  checkSongs(doc, out);
  checkSegments(doc, out);
  checkZones(doc, out);
  checkTotals(doc, out);
  return sortViolations(out);
}

export function sortViolations(list: Violation[]): Violation[] {
  // Same order as Python's sorted() on (code, pointer) string tuples (UTF-16 vs code point
  // order only differ above U+FFFF, which pointers here never contain).
  return [...list].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}

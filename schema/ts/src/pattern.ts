// Rules for the format 1.1 beat-counted position pattern (interval.pattern) that JSON Schema
// cannot state. Pure, no I/O. Twin of python/src/classformat/pattern.py.
// Errors join the semantic rules; "pattern_without_bpm" is a warning and is reported only by
// checkWarnings, never by checkDocument.
import type { Violation } from "./semantic.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = any;

/** Errors: the two lists differ in length, or `position` is not the pattern's first position. */
export function checkPatterns(doc: Doc, out: Violation[]): void {
  doc.intervals.forEach((iv: Doc, i: number) => {
    const p = iv.pattern;
    if (p === undefined) return;
    if (p.positions.length !== p.beats.length) {
      out.push(["pattern_length_mismatch", `/intervals/${i}/pattern/beats`]);
    }
    if (iv.position !== undefined && iv.position !== p.positions[0]) {
      out.push(["pattern_position_mismatch", `/intervals/${i}/position`]);
    }
  });
}

/**
 * Warnings of a schema-valid document, sorted like violations. An interval with a pattern
 * should lie inside songs that all have a `bpm`; a song window it overlaps without one, or no
 * song at all, gives `pattern_without_bpm` at the pattern.
 */
export function checkWarnings(doc: Doc): Violation[] {
  const out: Violation[] = [];
  doc.intervals.forEach((iv: Doc, i: number) => {
    if (iv.pattern === undefined) return;
    const end = iv.start_ms + iv.length_ms;
    const songs: Doc[] = doc.songs.filter((s: Doc) => s.start_ms < end && s.end_ms > iv.start_ms);
    if (songs.length === 0 || songs.some((s: Doc) => s.bpm === undefined)) {
      out.push(["pattern_without_bpm", `/intervals/${i}/pattern`]);
    }
  });
  return out.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
}

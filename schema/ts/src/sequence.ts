// Publication sequencing (ADR 0003 section 6). Pure: no I/O. Twin of sequence.py.

export type Outcome = "accepted" | "repeat" | "stale" | "conflict";

export interface Publication {
  number: number;
  removed: boolean;
  content_hash: string | null;
}

/**
 * What the backend does with an incoming publication, given what it stores (or null).
 * - nothing stored, or a higher number (also after a removal): accepted
 * - a lower number: stale (refused)
 * - the same number and the same content (same hash, or both removals): repeat, no change
 * - the same number and anything else (other hash, removal vs document): conflict (refused)
 */
export function decide(stored: Publication | null, incoming: Publication): Outcome {
  if (stored === null || incoming.number > stored.number) return "accepted";
  if (incoming.number < stored.number) return "stale";
  if (incoming.removed === stored.removed && incoming.content_hash === stored.content_hash) {
    return "repeat";
  }
  return "conflict";
}

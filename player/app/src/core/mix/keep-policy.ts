// Which mixes the cache's eviction keeps (ADR 0013 section 3): those of classes starting within the
// next 24 hours; the open class's mix is pinned by the mix player. Pure. The class format carries no
// start time and the class list is in title order, so the player cannot tell which of the account's
// classes start within 24 hours: every class in the account's synced list counts as one that may
// (the safe reading; a mix only a class no longer in the list names goes).
import { classMixOf } from "./class-mix.ts";

/** The mix ids the documents name, once each, in a fixed order. */
export function mixesNamed(docs: Iterable<Readonly<Record<string, unknown>>>): readonly string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    const music = doc.music;
    if (music === null || typeof music !== "object" || (music as { source?: unknown }).source !== "swedebeat") continue;
    const mix = classMixOf(music);
    if (mix !== null) ids.add(mix.id);
  }
  return [...ids].sort();
}

// A class document with songs for the e2e that runs the real scene (#824): the scene derives nothing from a class without songs
// (deriveClass returns null), so the sync fixture's song-less short class always leaves the room window on the plain screen.
// Read-only from the contract lane's examples; only the title changes, so each test has its own hash.
import { loadExample } from "./fixtures.ts";

export function classWithSongs(title = "Scene spin"): Record<string, unknown> {
  const doc = structuredClone(loadExample("valid/class-spotify-playlist.json")) as unknown as Record<string, unknown>;
  (doc.class as Record<string, unknown>).title = title;
  return doc;
}

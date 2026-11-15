// What the room screen's window is sent: the open class, the clock view and the music link view,
// the fields the room screen draws from (web/src/room/input.ts), the current beat pattern, and where each band button's
// press goes (closed values, core/room/band-routes.ts). Nothing else of the snapshot (the file
// name, the last error, the presenter's control labels) reaches that window. Pure.
import type { Snapshot } from "../snapshot.ts";
import { bandRoutesOf } from "./band-routes.ts";
import type { BandRoutes } from "./band-routes.ts";
import type { PatternSnapshot } from "../pattern-snapshot.ts";

export interface RoomFrame {
  readonly doc: Snapshot["doc"];
  readonly view: Snapshot["view"];
  readonly link: Snapshot["link"];
  readonly band: BandRoutes | null;
  /** The current beat pattern (side and count), or null. */
  readonly pattern: PatternSnapshot | null;
  /** True exactly while the presenter's "Playlist not loaded" notice shows (the link view's `playlistNotLoaded`, decided by `playlistNoticeAt`); false with no link. */
  readonly playlistNotLoaded: boolean;
}

/** A closed copy: only the four pattern fields reach the window. */
const patternOf = (p: PatternSnapshot | null): PatternSnapshot | null =>
  p === null ? null : { position: p.position, beat: p.beat, beatsLeft: p.beatsLeft, nextPosition: p.nextPosition };

export const roomFrameOf = (s: Snapshot): RoomFrame => ({ doc: s.doc, view: s.view, link: s.link, band: bandRoutesOf(s.band ?? null), pattern: patternOf(s.pattern ?? null), playlistNotLoaded: s.link?.playlistNotLoaded === true });

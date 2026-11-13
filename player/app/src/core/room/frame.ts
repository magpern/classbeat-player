// What the room screen's window is sent: the open class, the clock view and the music link view,
// the fields the room screen draws from (web/src/room/input.ts), and where each band button's
// press goes (closed values, core/room/band-routes.ts). Nothing else of the snapshot (the file
// name, the last error, the presenter's control labels) reaches that window. Pure.
import type { Snapshot } from "../snapshot.ts";
import { bandRoutesOf } from "./band-routes.ts";
import type { BandRoutes } from "./band-routes.ts";

export interface RoomFrame {
  readonly doc: Snapshot["doc"];
  readonly view: Snapshot["view"];
  readonly link: Snapshot["link"];
  readonly band: BandRoutes | null;
}

export const roomFrameOf = (s: Snapshot): RoomFrame => ({ doc: s.doc, view: s.view, link: s.link, band: bandRoutesOf(s.band ?? null) });

// What the room screen's window is sent: the open class, the clock view and the music link view,
// the fields the room screen draws from (web/src/room/input.ts). Nothing else of the snapshot
// (the file name, the last error, the presenter's control labels) reaches that window. Pure.
import type { Snapshot } from "../snapshot.ts";

export interface RoomFrame {
  readonly doc: Snapshot["doc"];
  readonly view: Snapshot["view"];
  readonly link: Snapshot["link"];
}

export const roomFrameOf = (s: Snapshot): RoomFrame => ({ doc: s.doc, view: s.view, link: s.link });

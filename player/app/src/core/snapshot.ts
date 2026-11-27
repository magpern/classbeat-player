// What the shell sends the presenter: the open class, the clock view and the last error. Pure.
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { ClockView } from "./clock/view.ts";
import type { MusicNotice } from "./music-files/music-notice.ts";
import type { ControlLabels } from "./link/while-following.ts";
import type { LinkView } from "./link/view.ts";
import type { PatternSnapshot } from "./pattern-snapshot.ts";
import type { BandRoutes } from "./room/band-routes.ts";

export interface FileError {
  readonly message: string;
  readonly details: readonly string[];
}

export interface Snapshot {
  /** Increases by one each time a class is opened; 0 before the first. */
  readonly loadId: number;
  readonly fileName: string | null;
  readonly doc: Class | null;
  readonly view: ClockView | null;
  readonly link: LinkView | null;
  /** The Next and Previous labels, from the same routing as the commands. */
  readonly controls: ControlLabels | null;
  /** Where each of the room screen's band buttons sends its press, from the same routing. */
  readonly band: BandRoutes | null;
  /** The current beat pattern (side and count); null outside a pattern and when the count is not known. */
  readonly pattern: PatternSnapshot | null;
  readonly error: FileError | null;
  /**
   * The instructor's music files notice for a local class on the manual clock (core/music-files/
   * music-notice.ts), set by the shell for the presenter only; absent otherwise. The room frame
   * is built field by field and never carries it.
   */
  readonly music?: MusicNotice | null;
}

export const EMPTY_SNAPSHOT: Snapshot = { loadId: 0, fileName: null, doc: null, view: null, link: null, controls: null, band: null, pattern: null, error: null };

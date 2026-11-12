// What the shell may ask of a reader beyond its readings. Types only. A reader with a helper
// process implements these; the manual reader and the fakes need none of them.
import type { MusicAction } from "../../core/music-command.ts";
import type { MusicReader } from "../../core/link/reader.ts";

export interface ShellReader extends MusicReader {
  /**
   * Told whether the instructor is following the music. A reader with a helper runs it only
   * while this is true, so nothing is read before the instructor picks "Follow the music".
   */
  setFollowing?(on: boolean): void;
  /** Play, pause or next in the music app itself, by name. Does nothing while not following. */
  control?(action: MusicAction): void;
  /** The application is quitting: stop the helper for good. */
  close?(): void;
}

// The presenter window's music states (docs/design/music-files.md, "Presenter window, during a
// class"), as the notice the shell puts on the snapshot, with the words the spec gives for each
// (mock-ups presenter-music-<name>). The shot run renders each at 1000x720 and 1280x800. Titles are
// made up; no path, no folder and no file name from the disk appears anywhere.
import { musicNoticeOf } from "../../src/core/music-files/music-notice.ts";
import type { MusicNotice } from "../../src/core/music-files/music-notice.ts";

export interface PresenterMusicState {
  /** The mock-up's own name; the shot is presenter-music-<name>-<w>x<h>.png. */
  readonly name: string;
  readonly notice: MusicNotice;
  /** Buttons pressed after the page loads. */
  readonly act: readonly string[];
  /** The words the spec gives. */
  readonly line: string;
  readonly detail: string;
  /** The plate's words while it is shown; null when no plate shows. */
  readonly plate: { readonly headline: string; readonly body: string } | null;
}

const failed = (why: "read" | "length"): MusicNotice => musicNoticeOf({ reason: "failed" }, { song: 0, why }, "Neon Avenue")!;

export const PRESENTER_MUSIC_STATES: readonly PresenterMusicState[] = [
  {
    name: "stopped",
    notice: failed("read"),
    act: [],
    line: "Manual clock, music stopped",
    detail: "Neon Avenue could not be played",
    plate: { headline: "The music stopped", body: "Neon Avenue could not be read. The clock keeps running." },
  },
  {
    name: "length",
    notice: failed("length"),
    act: [],
    line: "Manual clock, music stopped",
    detail: "Neon Avenue is the wrong length",
    plate: { headline: "The music stopped", body: "Neon Avenue is the wrong length. The clock keeps running." },
  },
  { name: "closed", notice: failed("read"), act: ["#music-close"], line: "Manual clock, music stopped", detail: "Neon Avenue could not be played", plate: null },
  {
    name: "missing-at-start",
    notice: musicNoticeOf({ reason: "missing", missing: [1, 4] }, null, null)!,
    act: [],
    line: "Manual clock",
    detail: "2 music files were missing when the class started",
    plate: null,
  },
];

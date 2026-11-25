// The download page (docs/design/download.md): public, no sign-in. It reads the release file the
// build put in the site's own bundle and shows one of four states: loading (while the file is
// read), the latest release, no release yet, or a file that could not be read. The loading and
// error states are for a slow or failed read of that file and nothing else.
import { readingOf } from "../core/download-model.ts";
import type { Reading } from "../core/download-model.ts";
import { readReleasesText } from "../net/releases.ts";
import { button, h1, note, plate, working } from "../ui/kit.ts";
import { releaseSections, waitingRows } from "./download-rows.ts";

export const DOWNLOAD_TITLE = "Download the player";

export interface DownloadEnv {
  /** Whether this page is still the one shown (the person may have moved on while the file was read). */
  readonly current: () => boolean;
  /** Reloads the page, as the browser's own reload does. */
  readonly reload: () => void;
}

/** What each reading shows under the heading. */
function bodyOf(reading: Reading, env: DownloadEnv): HTMLElement[] {
  switch (reading.kind) {
    case "found":
      return releaseSections(reading.release);
    case "none":
      return [note("No release yet", "No version of the player has been published. It will be listed here when there is one.")];
    case "unreadable":
      return [plate("The list of releases could not be read", "Reload the page. If it happens again, the page is at fault, not your computer.", button("Reload", { quiet: true, onPress: env.reload }))];
  }
}

export async function downloadPage(main: HTMLElement, env: DownloadEnv): Promise<void> {
  const head = h1(DOWNLOAD_TITLE);
  main.replaceChildren(head, working("Looking for the latest release"), waitingRows());
  const text = await readReleasesText();
  if (!env.current()) return;
  const reading: Reading = text === null ? { kind: "unreadable" } : readingOf(text);
  // The heading stays, so a person who had focus on it keeps it.
  main.replaceChildren(head, ...bodyOf(reading, env));
}

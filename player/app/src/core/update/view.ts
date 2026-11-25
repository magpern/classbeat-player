// What the renderer is told about updates (ADR 0014, section 5; docs/design/updates.md). Pure.
// Versions, the four status words and the two switches: never an address, a path or the feed.
import type { UpdateKind, UpdateStatus } from "./status.ts";
import { couldNotCheck } from "./status.ts";
import type { UpdateSettings } from "./settings.ts";

export interface UpdateView {
  /** The Settings status line. */
  readonly kind: UpdateKind;
  readonly current: string;
  /** The latest version the last successful check found, or null ("Not known"); kept while a new check runs. */
  readonly latest: string | null;
  /** The version for the class list's notice, or null for no notice. */
  readonly notice: string | null;
  /** False until a check has given a result (or failed): the words then say none has run yet. */
  readonly checked: boolean;
  readonly auto: boolean;
  readonly prereleases: boolean;
}

/**
 * The view from the last result shown (outside a class), the latest version the last check that
 * succeeded found, and whether a check is running. While a check runs the last result stays: its
 * latest version and its notice (no flicker to nothing). A failed check drops the notice, while
 * "Latest version" keeps what the last successful check found (updates.md, "Latest version"). Before
 * any result (automatic checks off and Check now not pressed yet) the player cannot say it is up to
 * date, so the status is "could not check", with no notice.
 */
export function viewOf(current: string, last: UpdateStatus | null, found: string | null, running: boolean, settings: UpdateSettings): UpdateView {
  const shown = last ?? couldNotCheck(current);
  return {
    kind: running ? "checking" : shown.kind,
    current,
    latest: shown.kind === "could not check" ? found : shown.latest,
    notice: shown.kind === "newer" ? shown.latest : null,
    checked: last !== null,
    auto: settings.auto,
    prereleases: settings.prereleases,
  };
}

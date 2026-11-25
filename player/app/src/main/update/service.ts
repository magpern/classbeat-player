// The update checker (ADR 0014, sections 1, 3 and 5; docs/design/updates.md). It checks at start
// and every 6 hours while "Check automatically" is on, and when the instructor presses Check now; a
// check already running is not started again. Each result goes through the class gate: while a
// class is open nothing is shown or reachable, and a result that arrives meanwhile is held until the
// class closes. The renderer gets an UpdateView (versions and words, never an address); the release
// page's address is built here, from the shown "newer" result only, and opened by the shell.
import { classChanged, NO_CLASS, statusArrived, visible } from "../../core/update/class-gate.ts";
import type { ClassGate } from "../../core/update/class-gate.ts";
import { readFeed } from "../../core/update/feed.ts";
import { feedOf } from "../../core/update/settings.ts";
import type { UpdateSettings } from "../../core/update/settings.ts";
import { couldNotCheck, releasePageAddress, statusAfter } from "../../core/update/status.ts";
import type { UpdateStatus } from "../../core/update/status.ts";
import { viewOf } from "../../core/update/view.ts";
import type { UpdateView } from "../../core/update/view.ts";
import type { FeedFetch } from "./feed-fetch.ts";

/** Every 6 hours while the player is open (updates.md, "Check automatically"). */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface SettingsStore {
  load(): UpdateSettings;
  save(s: UpdateSettings): void;
}

export interface UpdateDeps {
  /** The running player's version. */
  readonly current: string;
  readonly fetchFeed: FeedFetch;
  readonly store: SettingsStore;
  /** A class is open in the room and presenter windows, or pinned (updates.md, "The class gate"). */
  readonly classOpen: () => boolean;
  /** Opens a release page in the system browser; only an address from `releasePageAddress` reaches it. */
  readonly openPage: (address: string) => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface UpdateService {
  /** The first check (when automatic checks are on) and the 6-hour timer. */
  start(): void;
  /** What the class list and Settings show; null while a class is open. */
  view(): UpdateView | null;
  /** Check now. A check already running is not started again. Null (nothing done) while a class is open. */
  checkNow(): UpdateView | null;
  /** Opens the shown newer version's release page; false when there is none to open. */
  openReleasePage(): boolean;
  setAutomaticChecks(on: boolean): UpdateView | null;
  setPrereleases(on: boolean): UpdateView | null;
  stop(): void;
  /** Resolves when the check now running (if any) has ended; for tests. */
  idle(): Promise<void>;
}

export function createUpdateService(deps: UpdateDeps): UpdateService {
  let settings = deps.store.load();
  let gate: ClassGate = NO_CLASS;
  let running: Promise<void> | null = null;
  /** The latest version the last successful check found ("Latest version" after a failed one). */
  let found: string | null = null;
  let timer: unknown = null;
  let stopped = false;

  /** The gate as it is now: the class may have opened or closed since it was last looked at. */
  const now = (): ClassGate => (gate = classChanged(gate, deps.classOpen()));
  const view = (): UpdateView | null => {
    const g = now();
    return g.inClass ? null : viewOf(deps.current, visible(g), found, running !== null, settings);
  };

  async function fetchStatus(): Promise<UpdateStatus> {
    // Named apart from the release page's `address`, which the shell test pins (#810).
    const feed = feedOf(settings);
    // An override that is not an https: address: no request at all.
    const text = feed === null ? null : await deps.fetchFeed(feed);
    // The channel is read when the reply is in, so a Pre-releases change meanwhile counts.
    return text === null ? couldNotCheck(deps.current) : statusAfter(deps.current, readFeed(text), settings.prereleases);
  }

  function check(): void {
    if (running !== null || stopped) return;
    running = fetchStatus()
      .catch(() => couldNotCheck(deps.current))
      .then((status) => {
        if (stopped) return;
        if (status.kind !== "could not check") found = status.latest;
        gate = statusArrived(now(), status);
      })
      // A gate that could not be read keeps what it had; the check still ends.
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
  }

  function arm(): void {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    if (!settings.auto || stopped) return;
    timer = deps.setTimer(() => {
      timer = null;
      check();
      arm();
    }, CHECK_EVERY_MS);
  }

  function change(next: UpdateSettings): void {
    settings = next;
    try {
      deps.store.save(next);
    } catch {
      // The file could not be written: the setting holds for this run.
    }
  }

  return {
    start() {
      if (settings.auto) check();
      arm();
    },
    view,
    checkNow() {
      if (now().inClass) return null;
      check();
      return view();
    },
    openReleasePage() {
      const address = releasePageAddress(visible(now()));
      if (address === null) return false;
      deps.openPage(address);
      return true;
    },
    setAutomaticChecks(on) {
      if (now().inClass) return null;
      if (on !== settings.auto) {
        change({ ...settings, auto: on });
        arm();
      }
      return view();
    },
    setPrereleases(on) {
      if (now().inClass) return null;
      if (on !== settings.prereleases) {
        change({ ...settings, prereleases: on });
        // The answer may differ (updates.md, "Switch changes").
        check();
      }
      return view();
    },
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
    idle: () => running ?? Promise.resolve(),
  };
}

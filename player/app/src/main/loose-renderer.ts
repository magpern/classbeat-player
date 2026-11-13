// What the runtime guard reads of a live renderer (hardening.ts, refuseLoose), without importing
// Electron, so a unit test can hand it a fake. Anything it cannot read counts as loose, a throw
// included (#154 review, N-2): an internal such as `_getPreloadScript` can change on an upgrade.
import { looseExtras, looseKeys } from "./web-preferences.ts";

/** The parts of a session the guard reads. */
export interface LiveSession {
  getPreloadScripts(): readonly unknown[];
  isSpellCheckerEnabled(): boolean;
}

/** The parts of a WebContents the guard reads; `_getPreloadScript` is Electron's own (no public getter). */
export interface LiveRenderer {
  readonly session: LiveSession;
  getLastWebPreferences(): Readonly<Record<string, unknown>> | null;
  _getPreloadScript?: () => unknown;
}

/** Marks a renderer whose state could not be read: a getter threw. */
export const UNREADABLE = "unreadable";

/**
 * What is loose about `contents` (empty when it is hardened): its reported preferences, its session
 * (`defaultSession` is read only here, so its throw is caught too), its preload (one of `preloads`),
 * the session's preloads and spell checker. Names only, never values.
 */
export function looseRenderer(contents: LiveRenderer, defaultSession: () => unknown, preloads: readonly string[]): string[] {
  try {
    const ses = contents.session;
    const preload = typeof contents._getPreloadScript === "function" ? contents._getPreloadScript() : undefined;
    const extras = { preload, sessionPreloads: ses.getPreloadScripts().length, spellChecker: ses.isSpellCheckerEnabled() };
    return [...looseKeys(contents.getLastWebPreferences(), ses === defaultSession()), ...looseExtras(extras, preloads)];
  } catch {
    return [UNREADABLE];
  }
}

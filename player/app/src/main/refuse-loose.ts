// The runtime guard's action on a live renderer (hardening.ts): a renderer that is not hardened is
// closed. Nothing here may throw out of the Electron listener that calls it (#156 review, N-2): a
// throw from isDestroyed() refuses the renderer, a throw from the report is ignored, and a throw
// from close() ends the application (`fatal`), so a loose renderer never goes on loading.
// No Electron import, so a unit test can hand it throwing fakes.
import { looseRenderer, UNREADABLE } from "./loose-renderer.ts";
import type { LiveRenderer } from "./loose-renderer.ts";

/** The parts of a WebContents the refusal uses, on top of what the guard reads. */
export interface RefusableRenderer extends LiveRenderer {
  isDestroyed(): boolean;
  close(): void;
}

export interface RefuseDeps {
  /** Electron's default session, read lazily (looseRenderer catches its throw). */
  readonly defaultSession: () => unknown;
  /** The only preload paths a renderer may have. */
  readonly preloads: readonly string[];
  /** Where the refusal is reported: names only, never values. */
  readonly report: (message: string) => void;
  /** The last resort when close() throws: ends the application (app.exit in hardening.ts). */
  readonly fatal: () => void;
}

/** What is loose about `contents`, or `[]`; an isDestroyed() that throws counts as unreadable. */
function looseOf(contents: RefusableRenderer, deps: RefuseDeps): string[] {
  let destroyed: boolean;
  try {
    destroyed = contents.isDestroyed();
  } catch {
    return [UNREADABLE];
  }
  if (destroyed === true) return [];
  try {
    return looseRenderer(contents, deps.defaultSession, deps.preloads);
  } catch {
    // looseRenderer catches its own reads; this keeps the listener safe if that ever changes.
    return [UNREADABLE];
  }
}

/** Closes `contents` when it is not hardened. Never throws. */
export function refuseLoose(contents: RefusableRenderer, deps: RefuseDeps): void {
  const loose = looseOf(contents, deps);
  if (loose.length === 0) return;
  refuse(contents, loose, deps);
}

/** Closes `contents` for `reasons`; if close() throws, `fatal`. Never throws. */
export function refuse(contents: RefusableRenderer, reasons: readonly string[], deps: Pick<RefuseDeps, "report" | "fatal">): void {
  try {
    deps.report(`Refused a renderer that is not hardened (${reasons.join(", ")}).`);
  } catch {
    // The report is best effort; the close below is what matters.
  }
  try {
    // Closed at once. Inside a window.open that a handler wrongly allowed, this can leave the opener
    // waiting: that fails closed, and guardContents denies every window.open.
    contents.close();
    return;
  } catch {
    // Falls through: a renderer that cannot be closed must not go on, so the application ends.
  }
  try {
    deps.fatal();
  } catch {
    // Nothing is left to try, and the listener must not throw.
  }
}

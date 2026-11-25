// The rollback rule (ADR 0014, section 4). Pure, and used by nothing until installing is switched
// on with signing. A start marker names the new version before it is launched; the new version
// clears it once the class list has rendered. A start that finds the same marker a second time in
// a row goes back to the kept version and skips the new one until a higher version appears.
import { compareVersions, parseVersion } from "./semver.ts";

export interface StartMarker {
  readonly version: string;
  /** Starts that have found this marker so far. */
  readonly found: number;
}

export interface RollbackState {
  readonly marker: StartMarker | null;
  /** The version that failed to start; it is not offered again. */
  readonly skipped: string | null;
}

export const NO_ROLLBACK: RollbackState = { marker: null, skipped: null };

export type StartAction =
  /** No marker: start the installed version as usual. */
  | { readonly action: "start" }
  /** The first start of a new version: launch it and wait for it to clear the marker. */
  | { readonly action: "try new"; readonly version: string }
  /** The same marker a second time in a row: go back to the kept version. */
  | { readonly action: "revert"; readonly version: string };

/** A version may be offered unless it is the skipped one or older; a strictly higher one is offered again. */
export function mayOffer(s: RollbackState, version: string): boolean {
  const v = parseVersion(version);
  if (v === null) return false;
  if (s.skipped === null) return true;
  const skipped = parseVersion(s.skipped);
  return skipped === null || compareVersions(v, skipped) > 0;
}

/** The marker is written before the new version is launched. A version that may not be offered is refused (unchanged).
 *  A marker already pending for the same version is kept as it is: rewriting it must never reset its count, or a build
 *  that fails on every start, with a marker written before each launch, would never be reverted. */
export function markerWritten(s: RollbackState, version: string): RollbackState {
  if (!mayOffer(s, version)) return s;
  if (s.marker !== null && s.marker.version === version) return s;
  return { ...s, marker: { version, found: 0 } };
}

/** A start reads the marker and decides what to launch. */
export function started(s: RollbackState): { readonly state: RollbackState; readonly action: StartAction } {
  const m = s.marker;
  if (m === null) return { state: s, action: { action: "start" } };
  if (m.found === 0) return { state: { ...s, marker: { ...m, found: 1 } }, action: { action: "try new", version: m.version } };
  return { state: { marker: null, skipped: m.version }, action: { action: "revert", version: m.version } };
}

/** The new version rendered its class list and clears its own marker; a marker naming another version stays. */
export function markerCleared(s: RollbackState, version: string): RollbackState {
  return s.marker !== null && s.marker.version === version ? { ...s, marker: null } : s;
}

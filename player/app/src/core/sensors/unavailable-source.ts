// The source the player ships with: it reports "unavailable" and does nothing else.
// WAITING FOR THE OWNER (ADR 0012 section 6, docs/owner.md): reading the instructor's own sensors on
// this computer, and the app's own chooser for them, are not decided. Until they are, this stand-in
// is the only source the shipped presenter is given; the fake that drives the drawer and the
// chooser lives in test/ and is never bundled.
import type { SensorSource, SourceSnapshot } from "./types.ts";

const UNAVAILABLE: SourceSnapshot = { state: "unavailable", devices: [], nearby: [], failed: null };
const noop = (): void => undefined;

export const UNAVAILABLE_SOURCE: SensorSource = {
  snapshot: () => UNAVAILABLE,
  subscribe: () => noop,
  connect: noop,
  choose: noop,
  cancel: noop,
  disconnect: noop,
  reconnect: noop,
};

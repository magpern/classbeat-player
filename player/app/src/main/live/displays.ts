// When the live session checks the displays (#353, #381): on every display removed, and on every
// change of a display's metrics, which is also how mirroring shows (two screens become one), so a
// control code is never shown to the room until the next poll. The check itself is the live
// service's (`displaysChanged`). Takes Electron's `screen`, or a fake in the tests.
export type DisplayEvent = "display-removed" | "display-metrics-changed";

export const DISPLAY_EVENTS: readonly DisplayEvent[] = ["display-removed", "display-metrics-changed"];

export interface DisplayEvents {
  on(event: DisplayEvent, listener: () => void): unknown;
}

export function watchDisplays(screen: DisplayEvents, changed: () => void): void {
  for (const event of DISPLAY_EVENTS) screen.on(event, () => changed());
}

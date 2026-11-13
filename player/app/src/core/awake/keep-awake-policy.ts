// Whether the display must stay awake (pure, no Electron): only while a class is open and its
// clock runs, following or manual. Not when no class is open, paused, finished or closed.
import type { ClockView } from "../clock/view.ts";

export function mustKeepAwake(view: ClockView | null): boolean {
  return view !== null && view.status === "running";
}

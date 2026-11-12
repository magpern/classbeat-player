// The clock status line the presenter shows. Pure.
// ADR 0001 rule 2: a clock held at a song window's end is not "paused" (that word means the
// instructor or the music paused); the status says it is holding while the music plays.
import type { ClockView } from "./clock/view.ts";
import type { LinkView } from "./link/view.ts";

export function statusText(v: ClockView, link: LinkView | null): string {
  if (link?.mode === "following" && link.held) return "Holding at the end of the song";
  return v.holding ? `${v.status} (holding at the end)` : v.status;
}

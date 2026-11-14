// When the page asks for the Screen Wake Lock and when it lets go (ADR 0008, section 5; docs/design/
// play.md, "Keep-awake"). Pure: an event of the page's life in, what to do with the lock out.
//
// Asked for at Start and again on Resume, held through pauses, released at "Class Complete", at End
// class and when the page is hidden, and asked for again when the page is shown during a class.
import type { Status } from "../../../player/app/src/core/clock/clock.ts";
import type { PlayNotice } from "../room/input.ts";

export type WakeEvent = "start" | "resume" | "shown" | "hidden" | "ended" | "close";
export type WakeAction = "ask" | "release" | "none";

export function wakeAction(event: WakeEvent, status: Status): WakeAction {
  switch (event) {
    case "start":
    case "resume":
      return "ask";
    case "shown":
      return status === "running" || status === "paused" ? "ask" : "none";
    case "hidden":
    case "ended":
    case "close":
      return "release";
  }
}

/** The link slot's notice (play.md, "Wording"): after a reload until Start; the refused lock while the class runs or is paused. */
export function noticeOf(status: Status, reloaded: boolean, wakeRefused: boolean): PlayNotice | null {
  if (status === "ready") return reloaded ? "reloaded" : null;
  return wakeRefused && (status === "running" || status === "paused") ? "screen-may-turn-off" : null;
}

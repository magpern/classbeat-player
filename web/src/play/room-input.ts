// The room screen's input from the clock's view (ADR 0008, section 4). Pure. The link is always the
// manual clock: there is no music link on this page, so nothing is following, held or guessed.
import type { ClockView } from "../../../player/app/src/core/clock/view.ts";
import type { Class, LinkInput, PlayNotice, RoomInput } from "../room/input.ts";

/** The manual clock's link: nothing to follow, no hand-over, no announcement. */
function manualLink(view: ClockView): LinkInput {
  return {
    mode: "manual",
    available: false,
    state: "Manual",
    guessing: false,
    songIndex: view.songIndex,
    held: false,
    holdRemainingMs: null,
    candidates: [],
    announcement: null,
    classRemainingMs: view.classRemainingMs,
  };
}

export function roomInput(doc: Class, view: ClockView, notice: PlayNotice | null): RoomInput {
  return {
    doc,
    view: {
      status: view.status,
      classMs: view.classMs,
      lengthMs: view.lengthMs,
      classRemainingMs: view.classRemainingMs,
      intervalIndex: view.intervalIndex,
      intervalRemainingMs: view.intervalRemainingMs,
      nextIntervalIndex: view.nextIntervalIndex,
      songIndex: view.songIndex,
    },
    link: manualLink(view),
    notice,
    // Before the start the starting point may be moved by Previous and Next; the screen stays the one before the start.
    startingPoint: view.status === "ready",
  };
}

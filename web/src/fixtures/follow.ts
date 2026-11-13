// The rail after a hand-over (docs/design/room-2d.md, "Back to following the music"): the 30 s of
// "Following stopped", then "Manual · F to follow". Recorded as the running class and its worst case
// (H:MM:SS class times) with the clock manual; screenshotted at every room size.
import type { RoomInput } from "../room/input.ts";
import { linkAt } from "./build.ts";
import { STATE_FIXTURES } from "./states.ts";
import { WORST_FIXTURES } from "./worst.ts";

function manual(base: RoomInput, announcement: string | null): RoomInput {
  if (!base.view) throw new Error("the fixture has no clock view");
  return { ...base, link: linkAt(base.view, "Manual", { available: true, announcement, classRemainingMs: base.view.classRemainingMs }) };
}

export const FOLLOW_FIXTURES: Readonly<Record<string, RoomInput>> = {
  handover: manual(STATE_FIXTURES.running, "manual clock: following stopped"),
  "manual-follow": manual(STATE_FIXTURES.running, null),
  "worst-handover": manual(WORST_FIXTURES["worst-running"], "manual clock: following stopped"),
  "worst-manual-follow": manual(WORST_FIXTURES["worst-running"], null),
};

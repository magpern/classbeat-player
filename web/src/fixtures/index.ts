// The recorded snapshots: every state of the spec, and the worst case of every text slot.
import type { RoomInput } from "../room/input.ts";
import { BEAT_DRIFT } from "./beat.ts";
import { FOLLOW_FIXTURES } from "./follow.ts";
import { STATE_FIXTURES } from "./states.ts";
import { WORST_FIXTURES } from "./worst.ts";

export const FIXTURES: Readonly<Record<string, RoomInput>> = { ...STATE_FIXTURES, ...WORST_FIXTURES, ...FOLLOW_FIXTURES, "beat-drift": BEAT_DRIFT };
export const STATE_NAMES = Object.keys(STATE_FIXTURES);
export const WORST_NAMES = Object.keys(WORST_FIXTURES);
export const FOLLOW_NAMES = Object.keys(FOLLOW_FIXTURES);

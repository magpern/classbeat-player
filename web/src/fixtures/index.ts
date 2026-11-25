// The recorded snapshots: every state of the spec, and the worst case of every text slot.
import type { RoomInput } from "../room/input.ts";
import { FOLLOW_FIXTURES } from "./follow.ts";
import { PATTERN_FIXTURES, WORST_PATTERN_FIXTURES } from "./pattern.ts";
import { RUNNING_FIXTURES } from "./running-class.ts";
import { STATE_FIXTURES } from "./states.ts";
import { WORST_FIXTURES } from "./worst.ts";

export const FIXTURES: Readonly<Record<string, RoomInput>> = { ...STATE_FIXTURES, ...WORST_FIXTURES, ...FOLLOW_FIXTURES, ...PATTERN_FIXTURES, ...WORST_PATTERN_FIXTURES, ...RUNNING_FIXTURES };
export const STATE_NAMES = Object.keys(STATE_FIXTURES);
export const WORST_NAMES = Object.keys(WORST_FIXTURES);
export const FOLLOW_NAMES = Object.keys(FOLLOW_FIXTURES);
export const PATTERN_NAMES = [...Object.keys(PATTERN_FIXTURES), ...Object.keys(WORST_PATTERN_FIXTURES)];
export const RUNNING_NAMES = Object.keys(RUNNING_FIXTURES);

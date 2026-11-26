// The room page's native code: instructor mode's plugin, narrowed before the page sees it, to getClass
// (class-source.ts) and to the follow intents (follow-source.ts). main.ts takes these and nothing
// from modes/ (modes.test.ts).
import { instructorMode } from "../modes/bridge.ts";
import { roomClassSource, type RoomClassSource } from "./class-source.ts";
import { roomFollowSource, type RoomFollowSource } from "./follow-source.ts";

export const roomClass = (): RoomClassSource => roomClassSource(instructorMode());
export const roomFollow = (): RoomFollowSource => roomFollowSource(instructorMode());

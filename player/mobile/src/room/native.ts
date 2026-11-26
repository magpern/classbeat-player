// The room page's native code: instructor mode's plugin, narrowed to getClass before the page sees it
// (class-source.ts). main.ts takes this and nothing from modes/ (modes.test.ts).
import { instructorMode } from "../modes/bridge.ts";
import { roomClassSource, type RoomClassSource } from "./class-source.ts";

export const roomClass = (): RoomClassSource => roomClassSource(instructorMode());

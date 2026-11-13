// The clock commands the room window may send (room-2d.md, the control band and the keyboard):
// Start, Pause, Resume, Previous, Next, the 5 s steps, Undo and Follow. Pure. A closed set: the
// manual clock, picking an occurrence and the named music commands stay on the presenter, and
// anything not exactly one of the presenter's shapes (core/commands.ts) is refused (null).
import { parseClockCommand } from "../commands.ts";
import type { ClockCommand } from "../commands.ts";

export const ROOM_COMMAND_TYPES = ["start", "pause", "resume", "previous", "next", "jump", "undo", "follow"] as const;

export type RoomCommandType = (typeof ROOM_COMMAND_TYPES)[number];
export type RoomCommand = Extract<ClockCommand, { readonly type: RoomCommandType }>;

const isRoomType = (t: string): t is RoomCommandType => (ROOM_COMMAND_TYPES as readonly string[]).includes(t);

export function parseRoomCommand(v: unknown): RoomCommand | null {
  const c = parseClockCommand(v);
  return c !== null && isRoomType(c.type) ? (c as RoomCommand) : null;
}

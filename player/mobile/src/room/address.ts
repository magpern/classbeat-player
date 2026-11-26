// The room screen's address (issue #871): the class list opens room.html?id=<class id>, and the room
// screen takes the id only when the query is exactly that, with an id native code would look up. Pure.
import { CLASS_ID } from "../modes/classes.ts";

/** The address of the room screen for a class of the list. */
export const roomFor = (id: string): string => `room.html?id=${encodeURIComponent(id)}`;

/** The class id of the room screen's query, or null unless it is exactly `?id=<uuid>`. */
export function classIdOf(search: string): string | null {
  const m = /^\?id=([^&#=]*)$/.exec(search);
  return m !== null && CLASS_ID.test(m[1]) ? m[1] : null;
}

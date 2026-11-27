// Opens the class the instructor picked on the class list (issue #871): room.html?id=<class id>.
// The id is checked, the class asked of native code through the getClass intent (IntentPolicy.kt),
// and checked by the class format's reader (class-answer.ts). Only a class that opens gets a
// `window.room` and the room screen; any other end goes back to the class list with its plate
// (plate-words.ts), so the room screen never draws without a class and never from a fixture. A room
// screen that fails to load goes back to the plate too, never to a blank page. Side effects come in
// as `deps`.
import { classIdOf } from "./address.ts";
import { readClassAnswer } from "./class-answer.ts";
import type { RoomClassSource } from "./class-source.ts";
import { type ClockRoom, clockRoom, type ClockRoomDeps } from "./clock-room.ts";
import { refused } from "../swedebeat-off.ts";
import { listAfter, type NoClass } from "./plate-words.ts";

export interface OpenRoomDeps extends ClockRoomDeps {
  readonly search: string;
  /** Native code narrowed to getClass (class-source.ts). */
  readonly native: RoomClassSource;
  /** The iOS app with Swedebeat off (swedebeat-off.ts): a class from Swedebeat never opens. Off when left out. */
  readonly swedebeatOff?: boolean;
  /** Puts the room where the room screen reads it (`window.room`). */
  readonly install: (room: ClockRoom) => void;
  /** Loads the room screen's module, which reads the room as it first runs. */
  readonly mount: () => Promise<unknown>;
  /** Replaces this page (the class list with its plate). */
  readonly go: (href: string) => void;
}

/** "open" once the room screen runs the class; otherwise why not, after going back to the list. */
export async function openRoom(deps: OpenRoomDeps): Promise<"open" | NoClass> {
  const id = classIdOf(deps.search);
  const why = id === null ? "missing" : await opened(id, deps);
  if (why === "open") {
    try {
      await deps.mount();
      return why;
    } catch {
      // The class was read, but its screen could not run: the list says it cannot be opened.
      deps.go(listAfter("invalid"));
      return "invalid";
    }
  }
  deps.go(listAfter(why));
  return why;
}

async function opened(id: string, deps: OpenRoomDeps): Promise<"open" | NoClass> {
  let reply: unknown;
  try {
    reply = await deps.native.getClass({ id });
  } catch {
    return "missing"; // refused by native code
  }
  const answer = readClassAnswer(reply);
  if (!answer.ok) return answer.why;
  if (refused(deps.swedebeatOff === true, answer.doc.music.source)) return "swedebeat";
  deps.install(clockRoom(`${id}.json`, answer.doc, deps));
  return "open";
}

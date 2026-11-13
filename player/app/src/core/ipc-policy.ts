// Who may talk to the shell over IPC. Pure: the shell passes plain facts about the sender.
// A message is accepted only from the main window's own web contents, from its top frame, while
// that frame shows one of the two pages shipped with the application: the class list or the
// presenter. Each page may use only its own channels (the handlers ask `pageOf`).
// The room screen has a window of its own and is never one of those pages: it is recognised only
// by `isRoomSender`, and may use only ROOM_CHANNELS.
import { CH_ROOM_STATE } from "./channels.ts";

export interface SenderFacts {
  /** webContents id of the sender. */
  readonly senderId: number;
  /** True when the message came from the top frame, not from a subframe. */
  readonly topFrame: boolean;
  /** The URL of the frame that sent it. */
  readonly frameUrl: string;
}

export interface Trusted {
  /** webContents id of the main window, or null when there is none. */
  readonly presenterId: number | null;
  /** The presenter page's file URL, without query or fragment. */
  readonly presenterUrl: string;
  /** The class list page's file URL, without query or fragment. */
  readonly listUrl: string;
}

export type Page = "presenter" | "list";

const withoutQuery = (url: string): string => url.split(/[?#]/, 1)[0];

/** Which shipped page the sender is, or null when the message is not to be trusted. */
export function pageOf(s: SenderFacts, t: Trusted): Page | null {
  if (t.presenterId === null || s.senderId !== t.presenterId || !s.topFrame) return null;
  const url = withoutQuery(s.frameUrl);
  return url === t.presenterUrl ? "presenter" : url === t.listUrl ? "list" : null;
}

export const isTrustedSender = (s: SenderFacts, t: Trusted): boolean => pageOf(s, t) !== null;

/** The room screen's window, apart from the main window. */
export interface RoomTrusted {
  /** webContents id of the room window, or null when it is not open. */
  readonly roomId: number | null;
  /** The room page's file URL, without query or fragment. */
  readonly roomUrl: string;
}

/** The only channels the room page may invoke. It sends no command and reads no pairing. */
export const ROOM_CHANNELS: readonly string[] = [CH_ROOM_STATE];

/** The room window's own web contents, its top frame, on the room page. */
export function isRoomSender(s: SenderFacts, t: RoomTrusted): boolean {
  return t.roomId !== null && s.senderId === t.roomId && s.topFrame && withoutQuery(s.frameUrl) === t.roomUrl;
}

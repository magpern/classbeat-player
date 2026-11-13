// Who may talk to the shell over IPC. Pure: the shell passes plain facts about the sender.
// A message is accepted only from the main window's own web contents, from its top frame, while
// that frame shows one of the two pages shipped with the application: the class list or the
// presenter. Each page may use only its own channels (the handlers ask `pageOf`).

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

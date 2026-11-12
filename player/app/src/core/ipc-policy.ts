// Who may talk to the shell over IPC. Pure: the shell passes plain facts about the sender.
// A message is accepted only from the presenter window's own web contents, from its top frame,
// while that frame shows the presenter page shipped with the application.

export interface SenderFacts {
  /** webContents id of the sender. */
  readonly senderId: number;
  /** True when the message came from the top frame, not from a subframe. */
  readonly topFrame: boolean;
  /** The URL of the frame that sent it. */
  readonly frameUrl: string;
}

export interface Trusted {
  /** webContents id of the presenter window, or null when there is none. */
  readonly presenterId: number | null;
  /** The presenter page's file URL, without query or fragment. */
  readonly presenterUrl: string;
}

const withoutQuery = (url: string): string => url.split(/[?#]/, 1)[0];

export function isTrustedSender(s: SenderFacts, t: Trusted): boolean {
  return t.presenterId !== null && s.senderId === t.presenterId && s.topFrame && withoutQuery(s.frameUrl) === t.presenterUrl;
}

// The live plays of cached mixes (ADR 0013 section 5). A play id is 128 random bits, made here in
// the main process and bound to the room window's webContents id, the account and the mix. The
// request filter admits a `cbp-mix:` request only from that webContents with a live id, and the
// scheme answers only a live id. At most one play is live: a new one ends the one before, and a
// play ends when the class stops or changes, when the room window closes and at sign-out. Ids and
// the account are never logged.
import { randomBytes } from "node:crypto";

export interface Play {
  readonly id: string;
  readonly webContentsId: number;
  readonly account: string;
  readonly mixId: string;
}

export interface Plays {
  /** A new play for the room window; any play before it ends. */
  begin(webContentsId: number, account: string, mixId: string): Play;
  /** The live play with this id, from this webContents only; null for any other. */
  liveFrom(id: string, webContentsId: number): Play | null;
  /** The live play with this id, wherever the request came from (the scheme handler; the filter checked the sender). */
  live(id: string): Play | null;
  /** Ends the live play (stop, another class, the room closed, sign-out). */
  end(): void;
  /** Ends the play if it belongs to this webContents (the window closed). */
  endFor(webContentsId: number): void;
  /** Ends the play if it belongs to this account (sign-out, the pairing deleted). */
  endAccount(account: string): void;
}

export function createPlays(random: (n: number) => Buffer = randomBytes): Plays {
  let current: Play | null = null;
  return {
    begin(webContentsId, account, mixId) {
      current = { id: random(16).toString("hex"), webContentsId, account, mixId };
      return current;
    },
    liveFrom(id, webContentsId) {
      return current !== null && current.id === id && current.webContentsId === webContentsId ? current : null;
    },
    live(id) {
      return current !== null && current.id === id ? current : null;
    },
    end() {
      current = null;
    },
    endFor(webContentsId) {
      if (current?.webContentsId === webContentsId) current = null;
    },
    endAccount(account) {
      if (current?.account === account) current = null;
    },
  };
}

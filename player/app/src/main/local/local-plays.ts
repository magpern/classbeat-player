// The live plays of the instructor's own music files (ADR 0017 section 3). A play id is 128 random
// bits, made here in the main process for one song: bound to the room window's webContents id, the
// account, the class run (its load id) and the song index, and to the file the class names for that
// song (its SHA-256 and size, which never leave this process). The request filter admits a
// `cbp-local:` request only from that webContents with a live id, and the scheme answers only a
// live id. Two songs may play at once (an overlap), so several plays can be live. A play ends when
// its song stops, when the class stops or changes, when the room window closes and at sign-out.
// Ids, the account and the hashes are never logged.
import { randomBytes } from "node:crypto";

export interface LocalPlay {
  readonly id: string;
  readonly webContentsId: number;
  readonly account: string;
  /** The class run the play belongs to: the controller's load id. */
  readonly loadId: number;
  readonly songIndex: number;
  /** The song's file as the class names it: the scheme reads only the indexed file of this hash and size. */
  readonly sha256: string;
  readonly size: number;
}

export type LocalPlayOf = Omit<LocalPlay, "id">;

export interface LocalPlays {
  /** A new play for one song in the room window. */
  begin(p: LocalPlayOf): LocalPlay;
  /** The live play with this id, from this webContents only; null for any other. */
  liveFrom(id: string, webContentsId: number): LocalPlay | null;
  /** The live play with this id, wherever the request came from (the scheme handler; the filter checked the sender). */
  live(id: string): LocalPlay | null;
  /** Ends one play (its song stopped). */
  end(id: string): void;
  /** Ends every play (the class stopped or changed, or it fell back to the manual clock). */
  endAll(): void;
  /** Ends the plays of this webContents (the window closed). */
  endFor(webContentsId: number): void;
  /** Ends the plays of this account (sign-out, the pairing deleted). */
  endAccount(account: string): void;
}

export function createLocalPlays(random: (n: number) => Buffer = randomBytes): LocalPlays {
  const plays = new Map<string, LocalPlay>();
  const endWhere = (gone: (p: LocalPlay) => boolean): void => {
    for (const [id, p] of plays) if (gone(p)) plays.delete(id);
  };
  return {
    begin(p) {
      const play: LocalPlay = { id: random(16).toString("hex"), webContentsId: p.webContentsId, account: p.account, loadId: p.loadId, songIndex: p.songIndex, sha256: p.sha256, size: p.size };
      plays.set(play.id, play);
      return play;
    },
    liveFrom(id, webContentsId) {
      const p = plays.get(id);
      return p !== undefined && p.webContentsId === webContentsId ? p : null;
    },
    live: (id) => plays.get(id) ?? null,
    end(id) {
      plays.delete(id);
    },
    endAll() {
      plays.clear();
    },
    endFor: (webContentsId) => endWhere((p) => p.webContentsId === webContentsId),
    endAccount: (account) => endWhere((p) => p.account === account),
  };
}

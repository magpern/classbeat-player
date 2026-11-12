// One call at a time, for anything a reader asks of its helper. Pure: the caller passes the clock.
// A call that has not answered after `giveUpMs` no longer counts as in flight, and an answer to
// anything but the newest call (the slot was cleared meanwhile, or a newer call began) is not
// the answer any more.

export interface Ticket {
  /** True while this is still the slot's newest call. */
  current(): boolean;
  /** The call goes on with another step: its time starts again. */
  renew(): void;
  /** The call answered. False when it was no longer the newest one: its answer is then dropped. */
  end(): boolean;
}

export interface CallSlot {
  /** A call is in flight and has not been given up. */
  busy(): boolean;
  /** True, once, when the call in flight was given up without an answer; it is then forgotten. */
  lapsed(): boolean;
  /** A new call begins; whatever was in flight is no longer the newest. */
  begin(): Ticket;
  /** Forgets the call in flight; its answer will be dropped. */
  clear(): void;
}

/** `giveUpMs` may be Infinity: then only an answer, or `clear`, ends a call. */
export function createCallSlot(now: () => number, giveUpMs: number): CallSlot {
  let since: number | null = null;
  let turn = 0;
  const busy = (): boolean => since !== null && now() - since < giveUpMs;
  const clear = (): void => {
    since = null;
    turn += 1;
  };
  return {
    busy,
    lapsed() {
      if (since === null || busy()) return false;
      clear();
      return true;
    },
    begin() {
      since = now();
      const mine = ++turn;
      return {
        current: () => mine === turn,
        renew() {
          if (mine === turn) since = now();
        },
        end() {
          if (mine !== turn) return false;
          since = null;
          return true;
        },
      };
    },
    clear,
  };
}

// The riders of the host's live session as the presenter knows them (ADR 0007 sections 2 to 4;
// riders-panel.md). Pure. The list is the riders connected now, in the order of `rider_joined`
// (a rider announced again goes to the end), each a server-given id and the nickname the rider
// typed: nothing else of a rider exists here. It lives in the session's state, in the main
// process's memory only, and is gone when the session ends (session-types.ts `OFF`).
//
// - When the host reconnects, the server replays a `rider_joined` for every rider in and then a
//   `lock_state`: the replay is collected apart and replaces the list when `lock_state` comes, so
//   the presenter shows the last list seen, greyed, until then.
// - The lock is what the server last said (`lock_state`); a session starts open.
// - The 10 new join codes an hour are counted here, from the presses this window sent.

export interface Rider {
  /** The server's id for the rider: 8 random bytes, base64url, never derived from the token or the nickname. */
  readonly id: string;
  /** Shown as text only, never interpreted. */
  readonly nickname: string;
}

export interface Riders {
  readonly list: readonly Rider[];
  readonly locked: boolean;
  /** While a reconnected host waits for the replay to end: the riders announced so far. */
  readonly replay: readonly Rider[] | null;
  /** Monotonic times of this session's new-code requests within the last hour, oldest first. */
  readonly asked: readonly number[];
  /** The new code, shown in the presenter's state line until `until`. */
  readonly made: { readonly code: string; readonly until: number } | null;
}

/** ADR 0002's cap of open rider connections: the most the list holds. */
export const MAX_RIDERS = 60;
/** At most this many new join codes per session an hour (ADR 0007 section 3). */
export const NEW_CODES_PER_HOUR = 10;
export const HOUR_MS = 3_600_000;
/** How long the presenter shows a new code as text. */
export const MADE_MS = 10_000;

export const NO_RIDERS: Riders = { list: [], locked: false, replay: null, asked: [], made: null };

const without = (list: readonly Rider[], id: string): Rider[] => list.filter((r) => r.id !== id);
/** The rider at the end of the list; beyond the cap the server would not have let it in. */
const append = (list: readonly Rider[], r: Rider): readonly Rider[] => {
  const rest = without(list, r.id);
  return rest.length >= MAX_RIDERS ? list : [...rest, { id: r.id, nickname: r.nickname }];
};

/** The host's `welcome`: on a reconnect the server's replay begins and the list waits for it. */
export const ridersWelcomed = (r: Riders, reconnect: boolean): Riders => (reconnect ? { ...r, replay: [] } : r);

export function riderJoined(r: Riders, rider: Rider): Riders {
  return r.replay !== null ? { ...r, replay: append(r.replay, rider) } : { ...r, list: append(r.list, rider) };
}

export function riderLeft(r: Riders, id: string): Riders {
  return { ...r, list: without(r.list, id), replay: r.replay === null ? null : without(r.replay, id) };
}

/** `lock_state`: the lock as the server has it; it ends a replay, whose riders become the list. */
export const lockState = (r: Riders, locked: boolean): Riders => (r.replay !== null ? { ...r, locked, list: r.replay, replay: null } : { ...r, locked });

const recent = (asked: readonly number[], now: number): number[] => asked.filter((at) => at > now - HOUR_MS);

/** Whether another new code may be asked for now. */
export const canAskNewCode = (r: Riders, now: number): boolean => recent(r.asked, now).length < NEW_CODES_PER_HOUR;

/** A new code was asked for at `now`; the shown one stops being news. */
export const newCodeAsked = (r: Riders, now: number): Riders => ({ ...r, asked: [...recent(r.asked, now), now], made: null });

/** `join_code`: the new code, shown for 10 s. */
export const codeMade = (r: Riders, code: string, now: number): Riders => ({ ...r, made: { code, until: now + MADE_MS } });

/** The buttons act only on a list the server has confirmed: not during a replay. */
export const settled = (r: Riders): boolean => r.replay === null;

export const hasRider = (r: Riders, id: string): boolean => r.list.some((x) => x.id === id);

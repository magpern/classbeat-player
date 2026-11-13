// Class sync (plan, section 5: "Player API", "Offline", "A class being played is pinned",
// "Deletion and retention"; ADR 0002, sections 6 and 7) as a pure state machine: an event and the
// time in, the next state and the effects for the edge to carry out. No I/O, no timers, no clock.
//
// - The cursor moves only once everything up to it is on disk: a page's removals and classes are
//   applied one at a time, in order, and only then is its cursor committed. A crash or a failure
//   repeats the page, which is harmless (a class already held with the same hash is not fetched).
// - `resync_required` starts a full resync from 0. Its cursor is committed only at its end, after
//   every held class the server no longer lists is removed.
// - A removal deletes the cached document at once.
// - A class being played is a snapshot the edge holds; sync never changes it. A newer version is
//   cached and shown as available; it applies after the class.
// - `token_revoked`, `token_unknown` and the pairing ending wipe the cache, after any class being
//   played has ended (ADR 0002, section 6). A wipe is done only when the edge says it is on disk:
//   until then nothing is synced, for any account, and nothing is pinned; a failed wipe is tried
//   again with a backoff and at every start (the edge keeps a marker on disk until it succeeds). `token_expired` keeps it (the same table): the app
//   stops asking until it is paired again, and a new pairing to the same account continues.
// - No answer, a 5xx or a 429 never deletes anything; the app asks again later. Only the server's
//   own word deletes a class: a removal, `not_found`, a full resync that no longer lists it, or
//   the pairing gone. A class answer that cannot be kept is skipped, its cached copy kept.
import type { Change, FetchResult, ListResult, Refusal } from "./answers.ts";
import { backoffMs, retryWaitMs, SYNC_EVERY_MS } from "./backoff-policy.ts";

/** What the pairing says, without the token: whose account it is (an opaque key) and whether it ran out. */
export interface Credential {
  readonly account: string;
  readonly expired: boolean;
}

export type Status = "unpaired" | "syncing" | "synced" | "offline" | "waiting" | "expired";

type Applied = { readonly set: readonly [string, string] } | { readonly drop: readonly string[] } | { readonly cursor: number };
type Wait = { readonly for: "list" } | { readonly for: "fetch"; readonly id: string } | { readonly for: "write"; readonly then: Applied };

interface Run {
  readonly id: number;
  readonly account: string;
  /** A full resync: the cursor is committed only at its end. */
  readonly full: boolean;
  /** The cursor the current page was asked after. */
  readonly after: number;
  readonly page: { readonly cursor: number; readonly more: boolean } | null;
  /** The rest of the current page, applied in order. */
  readonly todo: readonly Change[];
  /** Whether the current page's cursor is on disk. */
  readonly committed: boolean;
  /** In a full resync, every class the server says the account holds. */
  readonly seen: ReadonlySet<string>;
  readonly wait: Wait;
}

export interface SyncState {
  /** Whose classes the cache holds, or null. */
  readonly account: string | null;
  /** The cursor on disk. */
  readonly cursor: number;
  /** The cached classes: id to content hash. */
  readonly held: ReadonlyMap<string, string>;
  readonly run: Run | null;
  readonly runs: number;
  readonly failures: number;
  readonly status: Status;
  /** The class being played: its id and the hash of the snapshot taken when it started. */
  readonly pinned: { readonly id: string; readonly hash: string } | null;
  /** The pairing ended, or the account changed, while a class played: wipe when it ends. */
  readonly wipeAfterPin: boolean;
  /** A wipe was asked and has not yet been reported done: nothing syncs or plays until it is. */
  readonly wipePending: boolean;
}

export type Effect =
  | { readonly do: "list"; readonly run: number; readonly after: number }
  | { readonly do: "fetch"; readonly run: number; readonly id: string }
  | { readonly do: "keep"; readonly run: number; readonly account: string; readonly id: string; readonly hash: string; readonly document: Readonly<Record<string, unknown>> }
  | { readonly do: "remove"; readonly run: number; readonly ids: readonly string[] }
  | { readonly do: "commit"; readonly run: number; readonly account: string; readonly cursor: number }
  /** Delete every cached class and the cursor; the result goes back in as `wiped`. */
  | { readonly do: "wipe" }
  /** Tell the pairing what the server said about its token. */
  | { readonly do: "report"; readonly kind: "gone" | "expired" }
  /** Send `due` at `at` (the edge's one timer; a new wake replaces the last). */
  | { readonly do: "wake"; readonly at: number };

export type SyncEvent =
  /** The cache on disk at start; `wipePending` when an earlier wipe did not finish. */
  | { readonly type: "loaded"; readonly account: string | null; readonly cursor: number; readonly held: ReadonlyMap<string, string>; readonly wipePending: boolean }
  | { readonly type: "due"; readonly credential: Credential | null }
  | { readonly type: "listed"; readonly run: number; readonly answer: ListResult }
  | { readonly type: "fetched"; readonly run: number; readonly id: string; readonly answer: FetchResult }
  /** The result of a keep, remove or commit: true when it is on disk. */
  | { readonly type: "written"; readonly run: number; readonly ok: boolean }
  /** The result of a wipe: true when nothing of the cache is left. */
  | { readonly type: "wiped"; readonly ok: boolean }
  /** The pairing ended: unpaired here, or the token deleted. */
  | { readonly type: "forgotten" }
  | { readonly type: "pin"; readonly id: string; readonly hash: string }
  | { readonly type: "unpin" };

export interface Step {
  readonly state: SyncState;
  readonly effects: readonly Effect[];
}

const EMPTY: ReadonlyMap<string, string> = new Map();
export const INITIAL: SyncState = { account: null, cursor: 0, held: EMPTY, run: null, runs: 0, failures: 0, status: "unpaired", pinned: null, wipeAfterPin: false, wipePending: false };

const stay = (state: SyncState): Step => ({ state, effects: [] });
const later = (state: SyncState, at: number, effects: readonly Effect[] = []): Step => ({ state, effects: [...effects, { do: "wake", at }] });

/** The cache emptied: nothing held, no account, no cursor. The pin and the counters stay. */
const emptied = (s: SyncState): SyncState => ({ ...s, account: null, cursor: 0, held: EMPTY, run: null, wipeAfterPin: false });

/** Forget the cache now and ask the edge to delete it; it counts as gone only once `wiped` says so. */
const wiping = (s: SyncState): Step => ({ state: { ...emptied(s), wipePending: true }, effects: [{ do: "wipe" }] });

function newRun(s: SyncState, account: string, full: boolean): Step {
  const run: Run = { id: s.runs + 1, account, full, after: full ? 0 : s.cursor, page: null, todo: [], committed: false, seen: new Set(), wait: { for: "list" } };
  return { state: { ...s, runs: run.id, run, status: "syncing" }, effects: [{ do: "list", run: run.id, after: run.after }] };
}

function due(s: SyncState, c: Credential | null, now: number): Step {
  if (s.run !== null || s.wipeAfterPin) return stay(s);
  // An unfinished wipe comes first, whoever is paired, or nobody.
  if (s.wipePending) return { state: s, effects: [{ do: "wipe" }] };
  if (c === null) return later({ ...s, status: "unpaired" }, now + SYNC_EVERY_MS);
  if (c.expired) return later({ ...s, status: "expired" }, now + SYNC_EVERY_MS);
  // A cache of another account (or of none recorded) is never shown to this one.
  if (s.account !== c.account && (s.account !== null || s.held.size > 0)) {
    if (s.pinned !== null) return stay({ ...s, wipeAfterPin: true, status: "unpaired" });
    // Synced from 0 once the wipe is reported done.
    return wiping(s);
  }
  return newRun(s, c.account, false);
}

/** The pairing is gone: wipe now, or once the class being played has ended. */
function forgotten(s: SyncState): Step {
  const ended: SyncState = { ...s, run: null, status: "unpaired" };
  if (s.pinned !== null) return stay({ ...ended, wipeAfterPin: true });
  return wiping(ended);
}

function wiped(s: SyncState, ok: boolean, now: number): Step {
  if (!s.wipePending) return stay(s);
  if (ok) return later({ ...s, wipePending: false, failures: 0 }, now);
  const failures = s.failures + 1;
  return later({ ...s, failures }, now + backoffMs(failures));
}

function refused(s: SyncState, r: Refusal, now: number): Step {
  if (r.kind === "gone") {
    const next = forgotten(s);
    return { state: next.state, effects: [{ do: "report", kind: "gone" }, ...next.effects] };
  }
  if (r.kind === "expired") return later({ ...s, run: null, status: "expired" }, now + SYNC_EVERY_MS, [{ do: "report", kind: "expired" }]);
  const failures = s.failures + 1;
  const wait = r.kind === "retry" ? retryWaitMs(failures, r.afterMs) : backoffMs(failures);
  return later({ ...s, run: null, failures, status: r.kind === "offline" ? "offline" : "waiting" }, now + wait);
}

const waiting = (s: SyncState, run: Run, wait: Wait, effect: Effect): Step => ({ state: { ...s, run: { ...run, wait } }, effects: [effect] });

/** The next thing to do in a run: apply the page's next change, commit, ask for the next page, or finish. */
function advance(s: SyncState, run: Run, now: number): Step {
  for (let i = 0; i < run.todo.length; i++) {
    const c = run.todo[i];
    const rest = { ...run, todo: run.todo.slice(i + 1) };
    if (c.removed) return waiting(s, rest, { for: "write", then: { drop: [c.id] } }, { do: "remove", run: run.id, ids: [c.id] });
    if (s.held.get(c.id) !== c.hash) return waiting(s, rest, { for: "fetch", id: c.id }, { do: "fetch", run: run.id, id: c.id });
  }
  const page = run.page;
  if (page === null) return stay(s);
  const idle = { ...run, todo: [] };
  const last = !page.more;
  if (run.full && last) {
    const leftovers = [...s.held.keys()].filter((id) => !run.seen.has(id));
    if (leftovers.length > 0) return waiting(s, idle, { for: "write", then: { drop: leftovers } }, { do: "remove", run: run.id, ids: leftovers });
  }
  if ((!run.full || last) && !run.committed) {
    return waiting(s, idle, { for: "write", then: { cursor: page.cursor } }, { do: "commit", run: run.id, account: run.account, cursor: page.cursor });
  }
  if (!last) {
    const next: Run = { ...idle, after: page.cursor, page: null, committed: false, wait: { for: "list" } };
    return { state: { ...s, run: next }, effects: [{ do: "list", run: run.id, after: page.cursor }] };
  }
  return later({ ...s, run: null, failures: 0, status: "synced" }, now + SYNC_EVERY_MS);
}

/** A write is on disk: the state says so, and the run waits for nothing. */
function applied(s: SyncState, run: Run, then: Applied): [SyncState, Run] {
  const free: Run = { ...run, wait: { for: "list" } };
  if ("cursor" in then) {
    const committed: Run = { ...free, committed: true };
    return [{ ...s, account: run.account, cursor: then.cursor, run: committed }, committed];
  }
  const held = new Map(s.held);
  if ("set" in then) held.set(then.set[0], then.set[1]);
  else for (const id of then.drop) held.delete(id);
  return [{ ...s, held, run: free }, free];
}

function listed(s: SyncState, run: Run, a: ListResult, now: number): Step {
  if (a.kind === "resync") return run.full ? refused(s, { kind: "unexpected" }, now) : newRun({ ...s, run: null }, run.account, true);
  if (a.kind !== "page") return refused(s, a, now);
  const seen = run.full ? new Set([...run.seen, ...a.changes.filter((c) => !c.removed).map((c) => c.id)]) : run.seen;
  return advance(s, { ...run, page: { cursor: a.cursor, more: a.more }, todo: a.changes, committed: false, seen }, now);
}

function fetched(s: SyncState, run: Run, id: string, a: FetchResult, now: number): Step {
  if (a.kind === "class") return waiting(s, run, { for: "write", then: { set: [id, a.hash] } }, { do: "keep", run: run.id, account: run.account, id, hash: a.hash, document: a.document });
  // Removed since the page was listed: the cached copy goes now; its removal comes in a later page.
  if (a.kind === "not_found") return waiting(s, run, { for: "write", then: { drop: [id] } }, { do: "remove", run: run.id, ids: [id] });
  // Not a class to keep: skipped, and any cached copy stays as it is.
  if (a.kind === "unusable") return advance(s, run, now);
  return refused(s, a, now);
}

export function step(s: SyncState, e: SyncEvent, now: number): Step {
  const run = s.run;
  switch (e.type) {
    case "loaded":
      if (s.runs !== 0 || run !== null) return stay(s);
      // A wipe asked before the cache was read, or left unfinished on disk, holds nothing.
      if (s.wipePending || e.wipePending) return stay({ ...emptied(s), wipePending: true });
      return stay({ ...s, account: e.account, cursor: e.cursor, held: e.held });
    case "due":
      return due(s, e.credential, now);
    case "listed":
      return run !== null && run.id === e.run && run.wait.for === "list" ? listed(s, run, e.answer, now) : stay(s);
    case "fetched":
      return run !== null && run.id === e.run && run.wait.for === "fetch" && run.wait.id === e.id ? fetched(s, run, e.id, e.answer, now) : stay(s);
    case "written":
      if (run === null || run.id !== e.run || run.wait.for !== "write") return stay(s);
      // Nothing that failed to reach the disk is counted as held; the page is repeated later.
      if (!e.ok) return refused(s, { kind: "unexpected" }, now);
      return advance(...applied(s, run, run.wait.then), now);
    case "wiped":
      return wiped(s, e.ok, now);
    case "forgotten":
      return forgotten(s);
    case "pin":
      // Only a class held now, as it is now, and never while a wipe waits.
      return !s.wipeAfterPin && !s.wipePending && s.held.get(e.id) === e.hash ? stay({ ...s, pinned: { id: e.id, hash: e.hash } }) : stay(s);
    case "unpin":
      if (s.pinned === null) return stay(s);
      if (s.wipeAfterPin) return wiping({ ...s, pinned: null });
      return stay({ ...s, pinned: null });
  }
}

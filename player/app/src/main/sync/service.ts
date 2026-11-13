// Runs class sync (core/sync/sync-model.ts): carries out its effects with the player API, the
// cache and one timer, and feeds the answers back in. One request at a time. The device token is
// read from the pairing for each request and goes only in that request, to the server that issued
// it. Nothing here logs: not a token, not a document, not an error.
import classSchema from "../../../../../schema/class-format/v1/class.schema.json" with { type: "json" };
import { isClassId, parseChanges, parseClass } from "../../core/sync/answers.ts";
import { INITIAL, step } from "../../core/sync/sync-model.ts";
import type { Effect, SyncEvent, SyncState } from "../../core/sync/sync-model.ts";
import { classListView } from "../../core/sync/class-list.ts";
import type { ClassRow } from "../../core/sync/class-list.ts";
import { lastingFault } from "../../core/sync/fault-policy.ts";
import { syncView } from "../../core/sync/view.ts";
import type { SyncView } from "../../core/sync/view.ts";
import type { HttpAnswer } from "../../core/pairing/protocol.ts";
import type { BackendCall, BackendRequest } from "../pairing/http.ts";
import type { ClassCache } from "./cache.ts";

/** The pairing as sync needs it. `account` is an opaque key for whose account the token reads. */
export interface SyncCredential {
  readonly origin: string;
  readonly token: string;
  readonly account: string;
  readonly expired: boolean;
}

export interface SyncDeps {
  readonly now: () => number;
  readonly call: BackendCall;
  readonly cache: ClassCache;
  readonly credential: () => SyncCredential | null;
  /** What the server said about the token, for the pairing to act on. */
  readonly report: (kind: "gone" | "expired") => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface SyncService {
  /** Reads the cache at startup (again later, after a fault reading it), and syncs. */
  start(): void;
  /** Syncs now, unless a sync is running (a new pairing, or the user asked). */
  syncNow(): void;
  /** The pairing ended (its token is already deleted): the cache is wiped, after any class being played. */
  forgotten(): void;
  view(): SyncView;
  /** The class list's rows: one per cached class that reads back with its hash, in title order. */
  list(): readonly ClassRow[];
  /**
   * Takes the snapshot of a cached class for play, or null when it is not held or does not read
   * back with its hash. Sync never changes it; a newer version applies after `unpin`.
   */
  pin(id: string): Readonly<Record<string, unknown>> | null;
  unpin(): void;
  stop(): void;
}

/** Changes asked per page, and the cap on a page's answer (500 changes with long source ids fit). */
export const PAGE_SIZE = 100;
export const MAX_PAGE_ANSWER_BYTES = 1024 * 1024;
/** An answer with a class document: a document is at most 1 MiB (ADR 0002, section 7). */
export const MAX_CLASS_ANSWER_BYTES = 2 * 1024 * 1024;

export function createSyncService(d: SyncDeps): SyncService {
  let state: SyncState = INITIAL;
  let timer: unknown = null;
  let stopped = false;
  const queue: SyncEvent[] = [];
  let running = false;

  /** The credential for a request of the running sync: only while it is still that account's. */
  const credentialFor = (run: number): SyncCredential | null => {
    const c = d.credential();
    return c !== null && !c.expired && state.run?.id === run && state.run.account === c.account ? c : null;
  };
  const ask = (c: SyncCredential, req: Omit<BackendRequest, "origin" | "token" | "method">, then: (a: HttpAnswer) => SyncEvent): void => {
    void d
      .call({ ...req, origin: c.origin, method: "GET", token: c.token })
      .catch((): HttpAnswer => ({ kind: "unreachable" }))
      .then((a) => dispatch(then(a)));
  };
  /** A write to the cache; its result goes back in as `written`. */
  const write = (run: number, fn: () => void): void => {
    let ok = true;
    try {
      fn();
    } catch {
      ok = false;
    }
    dispatch({ type: "written", run, ok });
  };

  /** Reads the cache into the model; true when it could be read. A fault keeps every file. */
  const load = (): boolean => {
    let stored;
    try {
      stored = d.cache.load();
    } catch (e) {
      dispatch({ type: "unreadable", lasting: lastingFault(e) });
      return false;
    }
    dispatch({ type: "loaded", ...stored });
    return true;
  };

  function run(e: Effect): void {
    switch (e.do) {
      case "load":
        // Read at last: sync goes on as it would have at start.
        if (load()) due();
        return;
      case "list": {
        const c = credentialFor(e.run);
        if (c === null) return dispatch({ type: "listed", run: e.run, answer: { kind: "unexpected" } });
        return ask(c, { path: `/api/player/changes?after=${e.after}&limit=${PAGE_SIZE}`, maxBodyBytes: MAX_PAGE_ANSWER_BYTES }, (a) => ({ type: "listed", run: e.run, answer: parseChanges(a, e.after) }));
      }
      case "fetch": {
        const c = credentialFor(e.run);
        if (c === null || !isClassId(e.id)) return dispatch({ type: "fetched", run: e.run, id: e.id, answer: { kind: "unexpected" } });
        return ask(c, { path: `/api/player/classes/${e.id}`, maxBodyBytes: MAX_CLASS_ANSWER_BYTES }, (a) => ({ type: "fetched", run: e.run, id: e.id, answer: parseClass(a, e.id, classSchema) }));
      }
      case "keep":
        return write(e.run, () => d.cache.keep(e.account, e.id, e.hash, e.document, e.publishedAt));
      case "remove":
        return write(e.run, () => d.cache.remove(e.ids));
      case "commit":
        return write(e.run, () => d.cache.commit(e.account, e.cursor));
      case "wipe": {
        // Done only when the cache says so; otherwise tried again later and at every start.
        let ok = true;
        try {
          d.cache.wipe();
        } catch {
          ok = false;
        }
        return dispatch({ type: "wiped", ok });
      }
      case "report":
        try {
          d.report(e.kind);
        } catch {
          // The pairing acts on it or not; sync has already stopped.
        }
        return;
      case "wake":
        if (timer !== null) d.clearTimer(timer);
        timer = d.setTimer(
          () => {
            timer = null;
            due();
          },
          Math.max(0, e.at - d.now()),
        );
        return;
    }
  }

  function dispatch(e: SyncEvent): void {
    if (stopped) return;
    queue.push(e);
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const out = step(state, next, d.now());
        state = out.state;
        for (const effect of out.effects) run(effect);
      }
    } finally {
      running = false;
    }
  }

  const due = (): void => {
    const c = d.credential();
    dispatch({ type: "due", credential: c === null ? null : { account: c.account, expired: c.expired } });
  };

  return {
    start() {
      // A cache that cannot be read is neither used nor wiped: the model asks to read it again later.
      if (load()) due();
    },
    syncNow: due,
    forgotten() {
      dispatch({ type: "forgotten" });
    },
    view: () => syncView(state),
    list() {
      const documents = new Map<string, Readonly<Record<string, unknown>>>();
      // The same guards as pin(): nothing while a wipe waits, or under another account's pairing.
      const c = d.credential();
      if (state.account === null || state.wipeAfterPin || state.wipePending || (c !== null && c.account !== state.account)) return [];
      for (const [id, hash] of state.held) {
        // Only the paired account's document that still has the hash it was kept with is listed.
        const found = d.cache.read(id);
        if (found !== null && found.hash === hash && found.account === state.account) documents.set(id, found.document);
      }
      return classListView(state, documents);
    },
    pin(id) {
      const hash = state.held.get(id);
      const account = state.account;
      if (hash === undefined || account === null || state.wipeAfterPin || state.wipePending) return null;
      // Only the paired account's class, from a file that says it is that account's.
      const c = d.credential();
      if (c !== null && c.account !== account) return null;
      const found = d.cache.read(id);
      if (found === null || found.hash !== hash || found.account !== account) return null;
      dispatch({ type: "pin", id, hash });
      return state.pinned?.id === id && state.pinned.hash === hash ? found.document : null;
    },
    unpin() {
      dispatch({ type: "unpin" });
    },
    stop() {
      stopped = true;
      if (timer !== null) d.clearTimer(timer);
      timer = null;
    },
  };
}

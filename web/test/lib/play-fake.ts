// The web player page on the fake site (site-fake.ts): the page, its files and the two class routes
// answer from recorded classes, with the clock paused, so every state is a function of what the test
// does. No network, no real account.
import type { Browser } from "playwright-core";
import type { Class } from "../../src/room/input.ts";
import { openSite } from "./site-fake.ts";
import type { FakeSite, Reply, Script } from "./site-fake.ts";

export const CLASS_ID = "3f6d2c1a-8b4e-4f7a-9c2d-1e5a7b9c0d3f";
export const OTHER_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

/** `GET classes/{id}`: one class with its document, as the route answers it. */
export const classAnswer = (doc: Class, id = CLASS_ID): Reply => ({
  status: 200,
  body: { class_id: id, source: "classbeat", source_class_id: "c-1", publication_number: 1, content_hash: "h".repeat(8), changed_at: "2026-11-02T09:00:00Z", document: doc },
});

/** One entry of `GET classes`, as the route gives it. */
export const entry = (id: string, title: string, lengthMs: number, changed = "2026-11-02T09:00:00Z", removed = false) => ({
  class_id: id, source: "classbeat", source_class_id: `src-${id.slice(0, 4)}`, publication_number: 1, removed, title, length_ms: lengthMs, changed_at: changed,
});

/** `GET classes`: a page of the library. */
export const listAnswer = (entries: readonly ReturnType<typeof entry>[], cursor: string | null = null): Reply => ({
  status: 200,
  body: { classes: entries, cursor, more: cursor !== null },
});

export const NOT_SIGNED_IN: Reply = { status: 401, body: { error: "not_signed_in" } };
export const NOT_FOUND: Reply = { status: 404, body: { error: "not_found" } };

export interface PlayOptions {
  readonly width: number;
  readonly height: number;
  /** The address after /play, with its #: `#<id>` opens a class. */
  readonly hash?: string;
  readonly script?: Script;
  /** A script run in the page ahead of its own (a wake lock or full screen stand-in). */
  readonly before?: string;
  /** Default true: the clock is paused and the test runs it on. */
  readonly clock?: boolean;
  readonly reducedMotion?: boolean;
}

/** Opens /play on the fake site. */
export function openPlay(browser: Browser, o: PlayOptions): Promise<FakeSite> {
  return openSite(browser, `/play${o.hash ?? ""}`, { width: o.width, height: o.height, script: o.script, before: o.before, clock: o.clock ?? true, reducedMotion: o.reducedMotion });
}

/** A script for a class that opens: its answer under the route's key. */
export const classScript = (doc: Class, id = CLASS_ID): Script => ({ "GET classes": listAnswer([entry(id, doc.class.title, doc.class.length_ms)]), [`GET classes/${id}`]: classAnswer(doc, id) });

// The two routes the page reads (ADR 0008, section 2), through the site's one way of talking to its
// backend: `GET /api/site/classes` (every page, with `before` and `limit`) and `GET
// /api/site/classes/{id}`, with the site cookie the browser sends. Nothing a request carries is
// kept, and nothing is written to the browser.
import type { Answer } from "../site/core/answer.ts";
import { call } from "../site/net/api.ts";
import { isPlayableClass } from "./doc-check.ts";
import { pageOf } from "./picker-model.ts";
import type { Row } from "./picker-model.ts";
import type { Class } from "../room/input.ts";

/** The most a page of the list may hold (the route takes 50 to 200). */
const LIMIT = 200;
/** A library cannot have more pages than this: a cursor that never ends is a fault, not a long list. */
const MAX_PAGES = 50;

/** Not the answer that was wanted: what the page shows instead. */
export type Failure = Exclude<Answer, { kind: "ok" }> | { readonly kind: "gone" };

export type Loaded<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "failed"; readonly why: Failure };

const failed = (why: Failure): Loaded<never> => ({ kind: "failed", why });

/** Every class of the account, read a page at a time (the page sorts them itself). */
export async function loadClasses(): Promise<Loaded<Row[]>> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < MAX_PAGES; n += 1) {
    const route: string = cursor === null ? `classes?limit=${LIMIT}` : `classes?before=${encodeURIComponent(cursor)}&limit=${LIMIT}`;
    const answer = await call("GET", route);
    if (answer.kind !== "ok") return failed(answer);
    const page = pageOf(answer.body);
    if (page === null) return failed({ kind: "server" });
    rows.push(...page.rows);
    if (page.next === null) return { kind: "ok", value: rows };
    cursor = page.next;
  }
  return failed({ kind: "server" });
}

/** One class of the account with its document. A class that is not there (404) is `gone`. */
export async function loadClass(id: string): Promise<Loaded<Class>> {
  const answer = await call("GET", `classes/${id}`);
  if (answer.kind === "refused" && (answer.status === 404 || answer.status === 422)) return failed({ kind: "gone" });
  if (answer.kind !== "ok") return failed(answer);
  const doc = typeof answer.body === "object" && answer.body !== null ? (answer.body as { document?: unknown }).document : undefined;
  return isPlayableClass(doc) ? { kind: "ok", value: doc } : failed({ kind: "server" });
}

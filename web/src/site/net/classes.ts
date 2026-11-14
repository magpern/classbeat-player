// The class routes the site's pages use (docs/design/site.md, "Classes"): every page of `GET
// classes`, and `DELETE classes/{id}`. Through the site's one way of talking to its backend.
import { pageOf } from "../core/classes-model.ts";
import type { Row } from "../core/classes-model.ts";
import type { Answer } from "../core/answer.ts";
import { call } from "./api.ts";

/** The most a page of the list may hold (the route takes 50 to 200). The first request names no limit and so carries no query (the site's pages send none); later pages ask for the most. */
const LIMIT = 200;
/** A library cannot have more pages than this: a cursor that never ends is a fault, not a long list. */
const MAX_PAGES = 50;

/** Every class of the account, a page at a time; an ok answer's body is the rows (the page sorts them). */
export async function readAllClasses(): Promise<Answer> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let n = 0; n < MAX_PAGES; n += 1) {
    const route: string = cursor === null ? "classes" : `classes?before=${encodeURIComponent(cursor)}&limit=${LIMIT}`;
    const answer = await call("GET", route);
    if (answer.kind !== "ok") return answer;
    const page = pageOf(answer.body);
    if (page === null) return { kind: "server" };
    rows.push(...page.rows);
    if (page.next === null) return { kind: "ok", status: 200, body: rows };
    if (seen.has(page.next)) return { kind: "server" };
    seen.add(page.next);
    cursor = page.next;
  }
  return { kind: "server" };
}

export const readClass = (id: string): Promise<Answer> => call("GET", `classes/${id}`);

export const deleteClass = (id: string): Promise<Answer> => call("DELETE", `classes/${id}`);

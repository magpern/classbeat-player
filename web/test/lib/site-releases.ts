// The release file of the download page on the fake (site-fake.ts): the page reads one file of its
// own bundle, `/releases.json` (docs/design/download.md). A test scripts it under the key
// "GET releases.json" like an API route: a body (a string is sent as it is, anything else as JSON),
// a status, no answer (`fail`) or a read that never ends (`hold`). With no entry the built file is served.
import type { Route } from "playwright-core";
import type { Reply, Script } from "./site-fake.ts";
import { withCsp } from "./site-files.ts";

export const RELEASES_KEY = "GET releases.json";

/** The scripted answer for the release file, or null when the test did not script one. */
export const scriptedReleases = (script: Script | undefined): Reply | null => {
  const entry = script?.[RELEASES_KEY];
  return entry === undefined ? null : (Array.isArray(entry) ? (entry[0] as Reply) : (entry as Reply));
};

/** Answers the release file's request from the script. A held read stays in `held` until the test releases it. */
export function answerReleases(route: Route, reply: Reply, csp: string, held: Route[]): Promise<void> {
  if (reply.fail) return route.abort("internetdisconnected");
  if (reply.hold) {
    held.push(route);
    return Promise.resolve();
  }
  const body = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
  return route.fulfill({ status: reply.status, headers: withCsp(csp, { "Cache-Control": "no-store", "Content-Type": "application/json", ...reply.headers }), body });
}

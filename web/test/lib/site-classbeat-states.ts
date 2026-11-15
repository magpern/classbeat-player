// Signing in with classbeat on the sign-in page, and what `/sign-in#error=classbeat` shows once
// `GET me` has answered (docs/design/site.md, "Sign in"; ADR 0010, sections 2, 5 and 6), and how
// to reach each state on the fake backend. Spread into STATES (site-states.ts), so the S1 to S12
// checks, the screenshots and "nothing secret leaves the page" run on every one. A state that goes
// to classbeat declares the one address it goes to (`toClassbeat`).
import type { Page } from "playwright-core";
import type { Reply, Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";
import { AUTHORIZE } from "./site-account-states.ts";

export const START = "POST sign-in/classbeat/start";
/** The callback's refusal, the one value the page reads. */
export const CLASSBEAT_ERROR = "/sign-in#error=classbeat";
/** `GET me` while signed in, and while signed out. */
export const SIGNED_IN_ME: Reply = { status: 200, body: { email: "ana@example.com" } };
export const SIGNED_OUT_ME: Reply = { status: 401, body: { error: "not_signed_in" } };
const GO: Reply = { status: 200, body: { authorize: AUTHORIZE } };

const press = (name: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name, exact: true }).click();
};
const signInWithClassbeat = press("Sign in with classbeat");
const confirmWithClassbeat = press("Confirm with classbeat");
const start = (reply: Reply): Script => ({ [START]: reply });
const stillSignedIn = (reply: Reply): Script => ({ "GET me": SIGNED_IN_ME, [START]: reply });

export const CLASSBEAT_STATES: readonly State[] = [
  // The sign-in page: "Sign in with classbeat" sends `{"purpose":"sign_in"}` and nothing else.
  { name: "sign-in-classbeat-opening", path: "/sign-in", script: start({ status: 200, hold: true }), steps: signInWithClassbeat, ready: ".status" },
  { name: "sign-in-classbeat-left", path: "/sign-in", script: start(GO), steps: signInWithClassbeat, ready: ".status", toClassbeat: AUTHORIZE },
  { name: "sign-in-classbeat-failed", path: "/sign-in", script: start({ status: 503, body: { error: "unavailable" } }), steps: signInWithClassbeat, ready: ".plate" },
  { name: "sign-in-classbeat-offline", path: "/sign-in", script: start({ status: 0, fail: true }), steps: signInWithClassbeat, ready: ".plate" },
  { name: "sign-in-classbeat-limited", path: "/sign-in", script: start({ status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "480" } }), steps: signInWithClassbeat, ready: ".plate" },
  // Reached from the companion: the same start, and one more sentence under the button.
  { name: "sign-in-classbeat-from-control-left", path: "/sign-in#return=control.BCDF-GHJK", script: start(GO), steps: signInWithClassbeat, ready: ".status", toClassbeat: AUTHORIZE },
  // `#error=classbeat`: `GET me` first.
  { name: "sign-in-classbeat-checking", path: CLASSBEAT_ERROR, script: { "GET me": { status: 200, hold: true } }, ready: ".status" },
  { name: "sign-in-classbeat-error", path: CLASSBEAT_ERROR, script: { "GET me": SIGNED_OUT_ME }, ready: ".plate", main: true },
  { name: "sign-in-classbeat-error-left", path: CLASSBEAT_ERROR, script: { "GET me": SIGNED_OUT_ME, ...start(GO) }, steps: signInWithClassbeat, ready: ".status", toClassbeat: AUTHORIZE },
  { name: "sign-in-classbeat-check-offline", path: CLASSBEAT_ERROR, script: { "GET me": { status: 0, fail: true } }, ready: ".plate" },
  { name: "sign-in-classbeat-check-server", path: CLASSBEAT_ERROR, script: { "GET me": { status: 500, body: { error: "internal" } } }, ready: ".plate" },
  { name: "sign-in-classbeat-check-limited", path: CLASSBEAT_ERROR, script: { "GET me": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } } }, ready: ".plate" },
  // Still signed in: classbeat did not confirm it is you. "Confirm with classbeat" sends `reauth`, never `sign_in`.
  { name: "sign-in-classbeat-not-confirmed", path: CLASSBEAT_ERROR, script: { "GET me": SIGNED_IN_ME }, ready: ".plate[data-confirm=ask]", main: true },
  { name: "sign-in-classbeat-not-confirmed-opening", path: CLASSBEAT_ERROR, script: stillSignedIn({ status: 200, hold: true }), steps: confirmWithClassbeat, ready: "[data-confirm=waiting]" },
  { name: "sign-in-classbeat-not-confirmed-left", path: CLASSBEAT_ERROR, script: stillSignedIn(GO), steps: confirmWithClassbeat, ready: "[data-confirm=waiting]", toClassbeat: AUTHORIZE },
  { name: "sign-in-classbeat-not-confirmed-failed", path: CLASSBEAT_ERROR, script: stillSignedIn({ status: 0, fail: true }), steps: confirmWithClassbeat, ready: ".plate[data-confirm=failed]" },
];

/** The one body each state's classbeat start carries: the purpose only (ADR 0010, section 6). */
export function expectedStartBody(state: State): string {
  const me = state.script?.["GET me"];
  const signedIn = me !== undefined && !Array.isArray(me) && (me as Reply).status === 200;
  return state.path.startsWith("/sign-in") && !signedIn ? '{"purpose":"sign_in"}' : '{"purpose":"reauth"}';
}

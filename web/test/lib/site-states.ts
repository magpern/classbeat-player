// Every state of the website pages this issue builds (docs/design/site.md, "Sign in" and
// "Errors"), and how to reach it on the fake backend: the address, the recorded answers and the
// steps a person takes. The checks and the flows both use this table.
import type { Page } from "playwright-core";
import type { Passkey, Script } from "./site-fake.ts";

export const LINK_TOKEN = `cbp_ml_${"Ab3_-".repeat(8)}xyz`;
export const CHALLENGE_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
export const PASSKEY_OPTIONS = { challenge: CHALLENGE_B64, timeout: 300000, rpId: "site.test", allowCredentials: [], userVerification: "required" };
export const EMAIL = "ana@example.com";

export interface State {
  readonly name: string;
  readonly path: string;
  readonly script?: Script;
  readonly passkey?: Passkey;
  /** The steps after the page has loaded. */
  readonly steps?: (page: Page) => Promise<void>;
  /** A selector that is on the page once the state is reached. */
  readonly ready: string;
  /** A main state: also shot at 820 and checked at 320 (site.md, "Layout at each size"). */
  readonly main?: boolean;
}

export const CLASS_DETAILS_ID = "3f6d2c1a-8b4e-4f7a-9c2d-1e5a7b9c0d3f";

const askLink = (email: string) => async (page: Page): Promise<void> => {
  await page.fill("input[name=email]", email);
  await page.click("button[type=submit]");
};
const pressText = (text: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: text }).click();
};
const signedInClasses: Script = { "GET classes": { status: 200, body: { classes: [], next: null } } };

export const STATES: readonly State[] = [
  { name: "sign-in", path: "/sign-in", ready: "input[name=email]", main: true },
  { name: "sign-in-no-passkey", path: "/sign-in", passkey: "absent", ready: "input[name=email]" },
  // Reached from the companion page while signed out (#263): the same page, coming back to /control.
  { name: "sign-in-from-control", path: "/sign-in#return=control.BCDF-GHJK", ready: "input[name=email]" },
  { name: "sign-in-invalid-email", path: "/sign-in", script: { "POST sign-in/link": { status: 422, body: { error: "invalid_email" } } }, steps: askLink("ana@example"), ready: ".field.err" },
  { name: "sign-in-limited", path: "/sign-in", script: { "POST sign-in/link": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "3000" } } }, steps: askLink(EMAIL), ready: ".plate" },
  { name: "sign-in-sent", path: "/sign-in", script: { "POST sign-in/link": { status: 200, body: { status: "accepted" } } }, steps: askLink(EMAIL), ready: ".note", main: true },
  { name: "sign-in-server", path: "/sign-in", script: { "POST sign-in/link": { status: 503, body: { error: "unavailable" } } }, steps: askLink(EMAIL), ready: ".plate" },
  { name: "sign-in-offline", path: "/sign-in", script: { "POST sign-in/link": { status: 0, fail: true } }, steps: askLink(EMAIL), ready: ".plate" },
  { name: "sign-in-link", path: `/sign-in#${LINK_TOKEN}`, ready: ".btn.primary:focus" },
  { name: "sign-in-link-working", path: `/sign-in#${LINK_TOKEN}`, script: { "POST sign-in/complete": { status: 200, hold: true } }, steps: pressText("Sign in"), ready: ".status" },
  { name: "sign-in-link-refused", path: `/sign-in#${LINK_TOKEN}`, script: { "POST sign-in/complete": { status: 401, body: { error: "sign_in_refused" } } }, steps: pressText("Sign in"), ready: ".plate" },
  { name: "sign-in-passkey-waiting", path: "/sign-in", passkey: "hold", script: { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS } }, steps: pressText("Sign in with a passkey"), ready: ".status" },
  { name: "sign-in-passkey-failed", path: "/sign-in", passkey: "cancel", script: { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS } }, steps: pressText("Sign in with a passkey"), ready: ".plate" },
  {
    name: "sign-in-passkey-limited",
    path: "/sign-in",
    script: { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "420" } } },
    steps: pressText("Sign in with a passkey"),
    ready: ".plate",
  },
  {
    // The options' limit (sign-ins started): neutral words, no failed sign-ins named (#257).
    name: "sign-in-passkey-wait",
    path: "/sign-in",
    script: { "POST sign-in/passkey/options": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } } },
    steps: pressText("Sign in with a passkey"),
    ready: ".plate",
  },
  {
    // Busy: another attempt from the same address is still being checked (#257).
    name: "sign-in-passkey-busy",
    path: "/sign-in",
    script: { "POST sign-in/passkey/options": { status: 200, body: PASSKEY_OPTIONS }, "POST sign-in/passkey": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "1" } } },
    steps: pressText("Sign in with a passkey"),
    ready: ".plate",
  },
  { name: "sign-in-session-ended", path: "/classes", script: { "GET classes": { status: 401, body: { error: "not_signed_in" } } }, ready: ".note" },
  { name: "signed-out", path: "/classes", script: { ...signedInClasses, "POST sign-out": { status: 204 } }, steps: pressText("Sign out"), ready: ".note" },
  {
    name: "account-deleted",
    path: "/sign-in",
    // The account page (second website issue) opens Sign in with this notice after a deletion.
    steps: async (page) => {
      await page.evaluate(() => history.replaceState({ notice: "deleted" }, "", "/sign-in"));
      await page.reload();
    },
    ready: ".note",
  },
  { name: "shell-signed-in", path: "/classes", script: signedInClasses, ready: "nav .a.cur", main: true },
  // The class details page's link to the web player page (ADR 0008, section 3; issue #396).
  { name: "class-details-play", path: `/classes/${CLASS_DETAILS_ID}`, script: { [`GET classes/${CLASS_DETAILS_ID}`]: { status: 200, body: { class_id: CLASS_DETAILS_ID } } }, ready: ".btns a" },
  { name: "error-too-many", path: "/classes", script: { "GET classes": { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "300" } } }, ready: ".plate" },
  { name: "error-offline", path: "/classes", script: { "GET classes": { status: 0, fail: true } }, ready: ".plate" },
  { name: "error-server", path: "/classes", script: { "GET classes": { status: 500, body: { error: "internal" } } }, ready: ".plate" },
  { name: "error-not-found", path: "/no-such-page", ready: "h1" },
];

// The states of Linked apps and Connect an app (docs/design/site.md, "Account"; ADR 0002, section 7)
// and how to reach each on the fake backend. Spread into STATES (site-states.ts), so the S1 to S12
// checks and "nothing secret leaves the page" run on every one. LINK_SECRETS ties what each state
// handles (the source's `state` and challenge from the address, the link code of the approval's
// answer) to this list.
import type { Page } from "playwright-core";
import { SOURCE_ORIGIN } from "./site-source-origin.ts";
import type { Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";

export const LINKS = [
  { id: "9d4e6f51-7e80-4192-bd0e-2f3a4b5c6d7e", source: "classbeat", name: "classbeat", linked_at: "2026-11-02T08:00:00+00:00", last_used_at: "2026-11-12T19:30:00+00:00" },
  { id: "ae5f7062-8f91-4203-8e1f-3a4b5c6d7e8f", source: "spin-notes", name: "Spin notes", linked_at: "2025-12-01T10:00:00+00:00", last_used_at: null },
] as const;
export const LINKS_LISTED: Script = { "GET source-links": { status: 200, body: { source_links: LINKS } } };

/** What classbeat puts in the address (ADR 0002, section 7, step 2): its own return address, a state and a challenge. */
export const REDIRECT_URI = `${SOURCE_ORIGIN}/player/linked`;
export const SOURCE_STATE = "st8-Xy_9.kQz7Lp";
export const CODE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const q = new URLSearchParams({ source: "classbeat", redirect_uri: REDIRECT_URI, state: SOURCE_STATE, code_challenge: CODE_CHALLENGE, code_challenge_method: "S256" });
export const CONNECT_PATH = `/link/source?${q.toString()}`;
/** The link code of the approval's answer, and the address that answer holds. */
export const LINK_CODE = `cbp_lc_${"Qm7_k".repeat(8)}w2Z`;
export const BACK = `${REDIRECT_URI}?${new URLSearchParams({ code: LINK_CODE, state: SOURCE_STATE }).toString()}`;

const signedIn: Script = { "GET sessions": { status: 200, body: { sessions: [] } } };
export const CHECKED = { status: 200, body: { source: "classbeat", name: "classbeat", scope: ["publish_classes", "remove_classes", "read_publication_numbers"] } } as const;
export const APPROVED = { status: 200, body: { redirect: BACK } } as const;
const asked = (approve?: Script[string]): Script => ({ ...signedIn, "POST source-links/check": CHECKED, ...(approve ? { "POST source-links/approve": approve } : {}) });

const press = (name: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name, exact: true }).first().click();
};
const then = (...steps: ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => {
  for (const s of steps) await s(page);
};
const connect = then(async (page) => void (await page.waitForSelector("[data-connect]:focus")), press("Connect classbeat"));
const l = (state: State): State => ({ clock: "day", ...state });

export const LINK_STATES: readonly State[] = [
  l({ name: "account-links", path: "/account/links", script: LINKS_LISTED, ready: ".ac-item", main: true }),
  l({ name: "account-links-empty", path: "/account/links", script: { "GET source-links": { status: 200, body: { source_links: [] } } }, ready: ".acct-body p + p" }),
  l({ name: "account-links-revoke", path: "/account/links", script: LINKS_LISTED, steps: press("Revoke"), ready: ".ac-panel [data-keep]:focus" }),
  l({ name: "account-links-revoked", path: "/account/links", script: { ...LINKS_LISTED, [`DELETE source-links/${LINKS[0].id}`]: { status: 204 } }, steps: then(press("Revoke"), press("Revoke app")), ready: ".note" }),
  l({ name: "account-links-revoke-offline", path: "/account/links", script: { ...LINKS_LISTED, [`DELETE source-links/${LINKS[0].id}`]: { status: 0, fail: true } }, steps: then(press("Revoke"), press("Revoke app")), ready: ".plate" }),
  { name: "account-links-server", path: "/account/links", script: { "GET source-links": { status: 500, body: { error: "internal" } } }, ready: ".plate" },
  { name: "link-source", path: CONNECT_PATH, script: asked(), ready: "[data-connect]:focus", main: true },
  { name: "link-source-checking", path: CONNECT_PATH, script: { ...signedIn, "POST source-links/check": { status: 200, hold: true } }, ready: ".status" },
  { name: "link-source-connecting", path: CONNECT_PATH, script: asked({ status: 200, hold: true }), steps: connect, ready: ".status" },
  { name: "link-source-done", path: CONNECT_PATH, script: asked(APPROVED), steps: connect, ready: ".note", leaves: BACK },
  { name: "link-source-unknown", path: CONNECT_PATH, script: { ...signedIn, "POST source-links/check": { status: 400, body: { error: "unknown_source" } } }, ready: ".plate" },
  { name: "link-source-limit", path: CONNECT_PATH, script: asked({ status: 409, body: { error: "too_many_links" } }), steps: connect, ready: ".plate" },
  { name: "link-source-check-offline", path: CONNECT_PATH, script: { ...signedIn, "POST source-links/check": { status: 0, fail: true } }, ready: ".plate" },
  { name: "link-source-approve-server", path: CONNECT_PATH, script: asked({ status: 503, body: { error: "unavailable" } }), steps: connect, ready: ".plate" },
];

/**
 * A value a state handles: where it is first seen (the page's own address it came in, a request
 * body, or the address the page left for), and the only places it may be. Anywhere else (another
 * request's address or body, the page's markup, the history, storage, the console) is a leak.
 */
export interface LinkSecret {
  readonly label: string;
  readonly value: string;
  readonly seen: { readonly in: "address" } | { readonly in: "body"; readonly route: string } | { readonly in: "left" };
  /** Request bodies it may go in. */
  readonly routes: readonly string[];
  /** It came in the page's own address, so that address and its load may hold it. */
  readonly inAddress: boolean;
  /** The address the page left for (the approval's answer) may hold it. */
  readonly inLeft: boolean;
}

const APPROVE = "POST source-links/approve";
const fromAddress = (approved: boolean): LinkSecret[] => [
  { label: "source state", value: SOURCE_STATE, seen: approved ? { in: "body", route: APPROVE } : { in: "address" }, routes: [APPROVE], inAddress: true, inLeft: true },
  { label: "code challenge", value: CODE_CHALLENGE, seen: approved ? { in: "body", route: APPROVE } : { in: "address" }, routes: [APPROVE], inAddress: true, inLeft: false },
];
const CODE: LinkSecret = { label: "link code", value: LINK_CODE, seen: { in: "left" }, routes: [], inAddress: false, inLeft: true };

/** What each state handles. Every state of LINK_STATES has an entry; the check compares the two lists. */
export const LINK_SECRETS: Readonly<Record<string, readonly LinkSecret[]>> = {
  "account-links": [],
  "account-links-empty": [],
  "account-links-revoke": [],
  "account-links-revoked": [],
  "account-links-revoke-offline": [],
  "account-links-server": [],
  "link-source": fromAddress(false),
  "link-source-checking": fromAddress(false),
  "link-source-connecting": fromAddress(true),
  "link-source-done": [...fromAddress(true), CODE],
  "link-source-unknown": fromAddress(false),
  "link-source-limit": fromAddress(true),
  "link-source-check-offline": fromAddress(false),
  "link-source-approve-server": fromAddress(true),
};

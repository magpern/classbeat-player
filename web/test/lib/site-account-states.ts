// The states of the account Sessions and Passkeys pages and "Confirm it is you" (docs/design/site.md,
// "Account") and how to reach each on the fake backend. Spread into STATES (site-states.ts), so the
// S1 to S12 checks and "nothing secret leaves the page" run on every one. ACCOUNT_SECRETS ties the
// secrets each state handles (challenges, the user handle, the credential's parts) to this list.
import type { Page } from "playwright-core";
import type { Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";
import { CLASSBEAT_ORIGIN } from "./site-source-origin.ts";

const b64 = (bytes: string | number[]): string => Buffer.from(bytes as string).toString("base64url");
const range = (from: number): number[] => Array.from({ length: 32 }, (_, i) => from + i);

/** The registration's challenge and user handle, as `POST passkeys/options` sends them. */
export const REG_CHALLENGE_BYTES = range(32);
export const REG_CHALLENGE = b64(REG_CHALLENGE_BYTES);
export const USER_HANDLE_BYTES = range(96);
export const USER_HANDLE = b64(USER_HANDLE_BYTES);

/** The credential the stand-in makes (site-passkey.ts, `create`), as the page sends it. */
export const NEW_CREDENTIAL = {
  id: "bmV3LWNyZWQtN2Y",
  rawId: b64("new-cred-7f"),
  clientDataJSON: b64('{"type":"webauthn.create","n":"cdj-5e"}'),
  attestationObject: b64("attestation-object-3c"),
} as const;

export const REG_OPTIONS = {
  rp: { name: "Class player", id: "site.test" },
  user: { id: USER_HANDLE, name: "ana@example.com", displayName: "ana@example.com" },
  challenge: REG_CHALLENGE,
  pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }, { type: "public-key", alg: -257 }],
  timeout: 300000,
  excludeCredentials: [{ id: b64("existing-1"), type: "public-key" }],
  authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
  attestation: "none",
} as const;

export const SESSIONS = [
  { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", browser: "Firefox", created_at: "2026-11-12T08:00:00+00:00", last_used_at: "2026-11-13T09:55:00+00:00", current: true },
  { id: "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e", browser: "Safari", created_at: "2026-11-03T07:30:00+00:00", last_used_at: "2026-11-11T19:10:00+00:00", current: false },
  { id: "3c4d5e6f-7081-4c9d-8e1f-2a3b4c5d6e7f", browser: "Chrome", created_at: "2026-10-21T12:00:00+00:00", last_used_at: "2026-11-08T16:20:00+00:00", current: false },
] as const;
export const PASSKEYS = [
  { id: "4d5e6f70-8192-4dae-9f20-3b4c5d6e7f80", name: "Laptop", created_at: "2026-11-03T09:00:00+00:00", last_used_at: "2026-11-12T08:00:00+00:00" },
  { id: "5e6f7081-92a3-4ebf-8031-4c5d6e7f8091", name: "Phone", created_at: "2026-11-03T09:05:00+00:00", last_used_at: "2026-11-09T18:00:00+00:00" },
  { id: "6f708192-a3b4-4fc0-9142-5d6e7f8091a2", name: "Work computer", created_at: "2025-10-21T14:00:00+00:00", last_used_at: null },
] as const;
export const NEW_PASSKEY = { id: "708192a3-b4c5-4d01-a253-6e7f8091a2b3", name: "Tablet", created_at: "2026-11-13T10:00:00+00:00", last_used_at: null } as const;
export const TEN = Array.from({ length: 10 }, (_, i) => ({ ...PASSKEYS[i % 3], id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, name: `Passkey ${i + 1}` }));

export const SESSIONS_LISTED: Script = { "GET sessions": { status: 200, body: { sessions: SESSIONS } } };
/** `GET passkeys` with adding open (`can_add: true`), so the add flows can be reached; the 403 `passkeys_closed` stays their fallback. */
export const PASSKEYS_LISTED: Script = { "GET passkeys": { status: 200, body: { passkeys: PASSKEYS, can_add: true } } };
/** `GET passkeys` for an account closed to adding (`can_add: false`), as the backend answers for every kind today (ADR 0010, section 7). */
export const PASSKEYS_CLOSED: Script = { "GET passkeys": { status: 200, body: { passkeys: PASSKEYS, can_add: false } } };
export const RECENT = { status: 403, body: { error: "recent_sign_in_required" } } as const;
/** Adding a passkey is closed for every account kind there is today (ADR 0010, section 7). */
export const CLOSED = { status: 403, body: { error: "passkeys_closed" } } as const;
/** classbeat's authorize address, as `POST sign-in/classbeat/start` answers it (ADR 0010, section 2). */
export const AUTHORIZE = `${CLASSBEAT_ORIGIN}/oauth/authorize?response_type=code&client_id=player&state=st-1&prompt=login`;
const regOptions: Script = { "POST passkeys/options": { status: 200, body: REG_OPTIONS } };
const START = "POST sign-in/classbeat/start";

const press = (name: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name, exact: true }).first().click();
};
const then = (...steps: ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => {
  for (const s of steps) await s(page);
};
const name = (typed: string) => async (page: Page): Promise<void> => {
  await page.fill("input[name=name]", typed);
};
const addAs = (typed: string) => then(press("Add a passkey"), name(typed), press("Add passkey"));
const endSecond = async (page: Page): Promise<void> => {
  await page.locator(`[data-session="${SESSIONS[1].id}"]`).click();
};
const endAll = then(press("Sign out everywhere"), async (page) => void (await page.locator(".ac-panel").getByRole("button", { name: "Sign out everywhere" }).click()));
const confirmByClassbeat = then(addAs("Tablet"), press("Confirm with classbeat"));
const removeFirst = then(press("Remove"), press("Remove passkey"));
const p = (state: State): State => ({ clock: "day", ...state });

export const ACCOUNT_STATES: readonly State[] = [
  p({ name: "account-sessions", path: "/account/sessions", script: SESSIONS_LISTED, ready: ".tag", main: true }),
  p({ name: "account-sessions-end-all", path: "/account/sessions", script: SESSIONS_LISTED, steps: press("Sign out everywhere"), ready: ".ac-panel [data-keep]:focus" }),
  p({ name: "account-sessions-ended", path: "/account/sessions", script: { ...SESSIONS_LISTED, [`DELETE sessions/${SESSIONS[1].id}`]: { status: 204 } }, steps: endSecond, ready: ".note" }),
  p({ name: "account-sessions-confirm", path: "/account/sessions", script: { ...SESSIONS_LISTED, "POST sessions/end-all": RECENT }, steps: endAll, ready: ".plate[data-confirm=ask]" }),
  p({ name: "account-sessions-end-all-offline", path: "/account/sessions", script: { ...SESSIONS_LISTED, "POST sessions/end-all": { status: 0, fail: true } }, steps: endAll, ready: ".plate" }),
  p({ name: "account-passkeys", path: "/account/passkeys", script: PASSKEYS_LISTED, ready: ".ac-item", main: true }),
  p({ name: "account-passkeys-empty", path: "/account/passkeys", script: { "GET passkeys": { status: 200, body: { passkeys: [], can_add: true } } }, ready: "[data-add]" }),
  p({ name: "passkey-add", path: "/account/passkeys", script: PASSKEYS_LISTED, steps: press("Add a passkey"), ready: "input[name=name]:focus" }),
  p({ name: "passkey-add-name", path: "/account/passkeys", script: PASSKEYS_LISTED, steps: addAs("   "), ready: ".field.err" }),
  p({ name: "passkey-add-waiting", path: "/account/passkeys", passkey: "hold", script: { ...PASSKEYS_LISTED, ...regOptions }, steps: addAs("Tablet"), ready: ".status" }),
  p({ name: "passkey-added", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, ...regOptions, "POST passkeys": { status: 201, body: NEW_PASSKEY } }, steps: addAs("Tablet"), ready: ".note" }),
  p({ name: "passkey-add-offline", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": { status: 0, fail: true } }, steps: addAs("Tablet"), ready: ".plate + p + form[data-add]" }),
  p({ name: "passkey-add-failed", path: "/account/passkeys", passkey: "cancel", script: { ...PASSKEYS_LISTED, ...regOptions }, steps: addAs("Tablet"), ready: ".plate" }),
  p({ name: "passkey-rename", path: "/account/passkeys", script: PASSKEYS_LISTED, steps: press("Rename"), ready: "input[name=name]:focus" }),
  p({ name: "passkey-rename-name", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, [`PATCH passkeys/${PASSKEYS[0].id}`]: { status: 422, body: { error: "invalid_name" } } }, steps: then(press("Rename"), name("Laptop 2"), press("Save")), ready: ".field.err" }),
  p({ name: "passkey-remove", path: "/account/passkeys", script: PASSKEYS_LISTED, steps: press("Remove"), ready: ".ac-panel [data-keep]:focus" }),
  p({ name: "passkey-remove-offline", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, [`DELETE passkeys/${PASSKEYS[0].id}`]: { status: 0, fail: true } }, steps: then(press("Remove"), press("Remove passkey")), ready: ".plate ~ .btns [data-add]:disabled" }),
  p({ name: "passkey-removed", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, [`DELETE passkeys/${PASSKEYS[0].id}`]: { status: 204 } }, steps: then(press("Remove"), press("Remove passkey")), ready: ".note" }),
  p({ name: "passkeys-limit", path: "/account/passkeys", script: { "GET passkeys": { status: 200, body: { passkeys: TEN, can_add: true } } }, ready: "[data-add]:disabled" }),
  p({ name: "recent-sign-in", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": RECENT }, steps: addAs("Tablet"), ready: ".plate[data-confirm=ask]" }),
  p({ name: "recent-sign-in-register", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, ...regOptions, "POST passkeys": RECENT }, steps: addAs("Tablet"), ready: ".plate[data-confirm=ask]" }),
  p({ name: "recent-sign-in-opening", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": RECENT, [START]: { status: 200, hold: true } }, steps: confirmByClassbeat, ready: ".status" }),
  // The one account state that goes to classbeat, and declares it (#508 B1).
  p({ name: "recent-sign-in-left", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": RECENT, [START]: { status: 200, body: { authorize: AUTHORIZE } } }, steps: confirmByClassbeat, ready: "[data-confirm=waiting]", toClassbeat: AUTHORIZE }),
  p({ name: "recent-sign-in-failed", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": RECENT, [START]: { status: 0, fail: true } }, steps: confirmByClassbeat, ready: ".plate[data-confirm=failed]" }),
  // ADR 0010, section 7: adding is closed, at either step; the list stays, to rename and remove.
  p({ name: "passkey-add-closed", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": CLOSED }, steps: addAs("Tablet"), ready: ".plate" }),
  p({ name: "passkey-add-closed-register", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, ...regOptions, "POST passkeys": CLOSED }, steps: addAs("Tablet"), ready: ".plate" }),
  p({ name: "passkeys-closed", path: "/account/passkeys", script: PASSKEYS_CLOSED, ready: ".reason" }),
  p({ name: "passkeys-closed-empty", path: "/account/passkeys", script: { "GET passkeys": { status: 200, body: { passkeys: [], can_add: false } } }, ready: ".reason" }),
  p({ name: "passkeys-closed-malformed", path: "/account/passkeys", script: { "GET passkeys": { status: 200, body: { passkeys: PASSKEYS } } }, ready: ".reason" }),
  p({ name: "passkeys-closed-removed", path: "/account/passkeys", script: { ...PASSKEYS_LISTED, "POST passkeys/options": CLOSED, [`DELETE passkeys/${PASSKEYS[0].id}`]: { status: 204 } }, steps: then(addAs("Tablet"), removeFirst), ready: ".note" }),
];

/** A secret a state handles: its text as it would leak, the routes whose body may carry it, and where it must be seen (so the check cannot pass with nothing to look for). */
export interface Secret {
  readonly label: string;
  readonly value: string;
  /** Request bodies it may go in. */
  readonly routes: readonly string[];
  /** Where it must be seen: in one of `routes`' bodies, or given to the browser's prompt (as these bytes). */
  readonly seen: { readonly body: string } | { readonly prompt: readonly number[] };
}

const REG: readonly Secret[] = [
  { label: "registration challenge", value: REG_CHALLENGE, routes: [], seen: { prompt: REG_CHALLENGE_BYTES } },
  { label: "user handle", value: USER_HANDLE, routes: [], seen: { prompt: USER_HANDLE_BYTES } },
];
const CREDENTIAL: readonly Secret[] = Object.entries(NEW_CREDENTIAL).map(([k, value]) => ({ label: `credential ${k}`, value, routes: ["POST passkeys"], seen: { body: "POST passkeys" } }));

/** The secrets each account state handles. Every state of ACCOUNT_STATES has an entry; the check compares the two lists. */
export const ACCOUNT_SECRETS: Readonly<Record<string, readonly Secret[]>> = {
  "account-sessions": [],
  "account-sessions-end-all": [],
  "account-sessions-ended": [],
  "account-sessions-confirm": [],
  "account-sessions-end-all-offline": [],
  "account-passkeys": [],
  "account-passkeys-empty": [],
  "passkey-add": [],
  "passkey-add-name": [],
  "passkey-add-waiting": REG,
  "passkey-added": [...REG, ...CREDENTIAL],
  "passkey-add-offline": [],
  "passkey-add-failed": REG,
  "passkey-rename": [],
  "passkey-rename-name": [],
  "passkey-remove": [],
  "passkey-remove-offline": [],
  "passkey-removed": [],
  "passkeys-limit": [],
  "recent-sign-in": [],
  "recent-sign-in-register": [...REG, ...CREDENTIAL],
  "recent-sign-in-opening": [],
  "recent-sign-in-left": [],
  "recent-sign-in-failed": [],
  "passkey-add-closed": [],
  "passkey-add-closed-register": [...REG, ...CREDENTIAL],
  "passkeys-closed": [],
  "passkeys-closed-empty": [],
  "passkeys-closed-malformed": [],
  "passkeys-closed-removed": [],
};

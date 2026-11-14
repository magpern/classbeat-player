// The states of Account: Your data (docs/design/site.md, "Your data"): the export and deleting the
// account, and how to reach each on the fake backend. Spread into STATES (site-states.ts), so the
// S1 to S12 checks run on every one. DATA_SECRETS ties what each state handles (the export file's
// content, the typed email address) to this list, for site-data-secrecy.test.ts.
import { readFile } from "node:fs/promises";
import type { Page } from "playwright-core";
import type { Reply, Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";

/** A class title only the export file holds: wherever else it is found, the file leaked. */
export const EXPORT_MARK = "Hill climb Zq7Rk-export-only";
export const EXPORT_BODY = {
  format: "class-player-export",
  account: { email: "ana@example.com" },
  classes: [{ class_id: "3f6d2c1a-8b4e-4f7a-9c2d-1e5a7b9c0d3f", title: EXPORT_MARK }],
} as const;
export const EXPORT_FILE = "class-player-export.json";
export const EXPORTED: Reply = { status: 200, body: EXPORT_BODY, headers: { "Content-Disposition": `attachment; filename="${EXPORT_FILE}"` } };
/** The addresses typed into the deletion's field: the account's, and one that is not. */
export const TYPED = "ana.deletes@example.com";
export const TYPED_WRONG = "ana.typo@example.org";

const RECENT = { status: 403, body: { error: "recent_sign_in_required" } } as const;
export const SIGNED_IN: Script = { "GET sessions": { status: 200, body: { sessions: [] } } };
const EXPORT = "POST account/export";
const DELETE = "POST account/delete";

/** The file each page's download saved, read from the browser's side. */
export const SAVED = new WeakMap<Page, { readonly name: string; readonly text: string }>();

const press = (name: string) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name, exact: true }).first().click();
};
const then = (...steps: ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => {
  for (const s of steps) await s(page);
};
/** "Download export", and the download it starts, kept in SAVED. */
const exportAndSave = async (page: Page): Promise<void> => {
  const [d] = await Promise.all([page.waitForEvent("download"), press("Download export")(page)]);
  const path = await d.path();
  SAVED.set(page, { name: d.suggestedFilename(), text: await readFile(path, "utf8") });
};
const type = (typed: string) => async (page: Page): Promise<void> => {
  await page.locator("input[name=confirm]").pressSequentially(typed);
};
const openDelete = press("Delete my account…");
const deleteAs = (typed: string) => then(openDelete, type(typed), press("Delete everything"));
const d = (state: Omit<State, "path">): State => ({ ...state, path: "/account/data" });

export const DATA_STATES: readonly State[] = [
  d({ name: "account-data", script: SIGNED_IN, ready: "[data-export]", main: true }),
  d({ name: "account-data-exporting", script: { ...SIGNED_IN, [EXPORT]: { status: 200, hold: true } }, steps: press("Download export"), ready: ".status" }),
  d({ name: "account-export-started", script: { ...SIGNED_IN, [EXPORT]: EXPORTED }, steps: exportAndSave, ready: ".note" }),
  d({ name: "account-export-limit", script: { ...SIGNED_IN, [EXPORT]: { status: 429, body: { error: "too_many_requests" }, headers: { "Retry-After": "25200" } } }, steps: press("Download export"), ready: ".plate" }),
  d({ name: "account-export-confirm", script: { ...SIGNED_IN, [EXPORT]: RECENT }, steps: press("Download export"), ready: ".plate[data-confirm=ask]" }),
  d({ name: "account-export-offline", script: { ...SIGNED_IN, [EXPORT]: { status: 0, fail: true } }, steps: press("Download export"), ready: ".plate" }),
  d({ name: "account-delete", script: SIGNED_IN, steps: openDelete, ready: ".ac-panel [data-keep]:focus" }),
  d({ name: "account-delete-typed", script: SIGNED_IN, steps: then(openDelete, type(TYPED)), ready: ".ac-panel button[type=submit]:enabled" }),
  d({ name: "account-delete-mismatch", script: { ...SIGNED_IN, [DELETE]: { status: 422, body: { error: "confirmation_mismatch" } } }, steps: deleteAs(TYPED_WRONG), ready: ".field.err input:focus" }),
  d({ name: "account-delete-confirm", script: { ...SIGNED_IN, [DELETE]: RECENT }, steps: deleteAs(TYPED), ready: ".plate[data-confirm=ask]" }),
  d({ name: "account-delete-offline", script: { ...SIGNED_IN, [DELETE]: { status: 0, fail: true } }, steps: deleteAs(TYPED), ready: ".plate + .ac-panel" }),
  // The signed-out page with "Your account was deleted", reached by a deletion (204).
  d({ name: "account-deleted", script: { ...SIGNED_IN, [DELETE]: { status: 204 } }, steps: deleteAs(TYPED), ready: ".note" }),
];

/**
 * A value a state handles, and where it must first be seen so the check has something real to look
 * for: the file the download saved, the body of `POST account/delete`, or the field it was typed in.
 * Anywhere else (an address, another request, the markup, the history, storage, the console) is a leak.
 */
export interface DataSecret {
  readonly label: string;
  readonly value: string;
  readonly seen: "file" | "delete-body" | "field";
}

const FILE: DataSecret = { label: "export file content", value: EXPORT_MARK, seen: "file" };
const sent = (value: string): DataSecret => ({ label: "typed email", value, seen: "delete-body" });

/** What each state handles. Every state of DATA_STATES has an entry; the check compares the two lists. */
export const DATA_SECRETS: Readonly<Record<string, readonly DataSecret[]>> = {
  "account-data": [],
  "account-data-exporting": [],
  "account-export-started": [FILE],
  "account-export-limit": [],
  "account-export-confirm": [],
  "account-export-offline": [],
  "account-delete": [],
  "account-delete-typed": [{ label: "typed email", value: TYPED, seen: "field" }],
  "account-delete-mismatch": [sent(TYPED_WRONG)],
  "account-delete-confirm": [sent(TYPED)],
  "account-delete-offline": [sent(TYPED)],
  "account-deleted": [sent(TYPED)],
};

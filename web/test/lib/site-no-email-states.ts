// Deleting an account that has no email (#505; ADR 0010, section 8): `GET me` answers
// `{"email": null}`, and the deletion panel asks for the words "your classbeat account" in place of
// the address. Only the states whose screen differs from the account with an email are listed
// (the page itself, the plates and the deleted note are the same). Spread into STATES
// (site-states.ts), so the S1 to S12 checks run and the screenshots are taken on every one.
import type { Page } from "playwright-core";
import type { Script } from "./site-fake.ts";
import type { State } from "./site-states.ts";

/** Signed in with an account that has no email. */
export const NO_EMAIL_ME: Script = { "GET me": { status: 200, body: { email: null } } };
/** The words, as a person might type them (the server compares them, case and surrounding spaces aside). */
export const TYPED_WORDS = "Your classbeat account";
export const TYPED_WORDS_WRONG = "my classbeat account";

const DELETE = "POST account/delete";

const openDelete = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Delete my account…", exact: true }).click();
};
const type = (typed: string) => async (page: Page): Promise<void> => {
  await openDelete(page);
  await page.locator("input[name=confirm]").pressSequentially(typed);
};
const deleteAs = (typed: string) => async (page: Page): Promise<void> => {
  await type(typed)(page);
  await page.getByRole("button", { name: "Delete everything", exact: true }).click();
};

export const NO_EMAIL_STATES: readonly State[] = [
  { name: "account-delete-no-email", path: "/account/data", script: NO_EMAIL_ME, steps: openDelete, ready: ".ac-panel [data-keep]:focus" },
  { name: "account-delete-no-email-typed", path: "/account/data", script: NO_EMAIL_ME, steps: type(TYPED_WORDS), ready: ".ac-panel button[type=submit]:enabled" },
  {
    name: "account-delete-no-email-mismatch",
    path: "/account/data",
    script: { ...NO_EMAIL_ME, [DELETE]: { status: 422, body: { error: "confirmation_mismatch" } } },
    steps: deleteAs(TYPED_WORDS_WRONG),
    ready: ".field.err input:focus",
  },
];

// The states of docs/design/updates.md ("States"), as the class list view and the update status the
// shell would send: the eleven reference mock-ups (the not-updated row is the class list's own state)
// plus the notice kept while a new check runs. A null status is the class gate: a class is open.
import type { UpdateView } from "../../src/core/update/view.ts";
import type { ListView } from "../../src/core/list/view.ts";
import { STATES } from "./states.ts";

export interface UpdateState {
  readonly name: string;
  readonly list: ListView;
  readonly update: UpdateView | null;
  /** Shown on the Settings page (opened with Ctrl+,), else on the class list. */
  readonly settings: boolean;
  /** Keys pressed after the page is shown (the focus ring on a switch). */
  readonly keys?: readonly string[];
  /** Words the Settings page must show (the status detail line). */
  readonly says?: string;
}

const list = (name: string): ListView => STATES.find((s) => s.name === name)!.view;
export const U = (over: Partial<UpdateView>): UpdateView => ({ kind: "up to date", current: "0.1.0", latest: "0.1.0", notice: null, checked: true, auto: true, prereleases: false, ...over });

export const NEWER = U({ kind: "newer", latest: "0.2.0", notice: "0.2.0" });
const NEWER_PRE = U({ kind: "newer", latest: "0.3.0-rc.1", notice: "0.3.0-rc.1", prereleases: true });

export const UPDATE_STATES: readonly UpdateState[] = [
  { name: "list-up-to-date", list: list("synced"), update: U({}), settings: false },
  { name: "list-newer", list: list("synced"), update: NEWER, settings: false },
  { name: "list-newer-long", list: list("long-list"), update: NEWER, settings: false },
  { name: "list-newer-prerelease", list: list("synced"), update: NEWER_PRE, settings: false },
  { name: "list-checking-keeps-notice", list: list("synced"), update: { ...NEWER, kind: "checking" }, settings: false },
  { name: "list-class-playing", list: list("pinned-newer"), update: null, settings: false },
  { name: "up-to-date", list: list("synced"), update: U({}), settings: true },
  { name: "newer", list: list("synced"), update: NEWER, settings: true },
  { name: "newer-prerelease", list: list("synced"), update: NEWER_PRE, settings: true },
  { name: "checking", list: list("synced"), update: U({ kind: "checking" }), settings: true },
  { name: "could-not-check", list: list("synced"), update: U({ kind: "could not check", latest: null }), settings: true, says: "The list of releases could not be read. Press Check now to try again." },
  { name: "before-any-check", list: list("synced"), update: U({ kind: "could not check", latest: null, checked: false, auto: false }), settings: true, says: "No check has run yet. Press Check now." },
  { name: "auto-off", list: list("synced"), update: U({ auto: false, prereleases: true }), settings: true, keys: ["Tab"] },
];

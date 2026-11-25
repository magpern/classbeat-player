// The Swedebeat words on the class list (core/mix/list-model.ts, core/list/screen.ts) against
// docs/design/swedebeat.md, "Class list page": every state's line or plate, no field while the
// source is off or no keychain, the form only while sign-in is offered, and the row and footer words.
import assert from "node:assert/strict";
import { test } from "node:test";
import { screenOf } from "../../src/core/list/screen.ts";
import type { ListUi } from "../../src/core/list/view.ts";
import { footerReason, mixHeadOf, rowMixOf } from "../../src/core/mix/list-model.ts";
import type { MixUi } from "../../src/core/mix/list-model.ts";
import { MIX_DISABLED, fieldsView, mayOfferSignIn } from "../../src/core/mix/view.ts";
import type { MixView } from "../../src/core/mix/view.ts";
import { NOW, row, view } from "./list-fixtures.ts";

const FIELDS = fieldsView([{ name: "username", secret: false }, { name: "password", secret: true }]);
const OUT: MixView = { ...MIX_DISABLED, state: "signed_out", fields: FIELDS };
const mv = (over: Partial<MixView>): MixView => ({ ...OUT, ...over });
const head = (v: MixView, ui: MixUi = "none", listed = true) => mixHeadOf(v, ui, listed);
const UI: ListUi = { filter: "", selectedId: null, lastStartedId: null };

test("each state has the spec's words", () => {
  const cases: [MixView, MixUi, string][] = [
    [OUT, "none", "Swedebeat is not connected"],
    [mv({ state: "signed_in", fields: [] }), "none", "Swedebeat is connected"],
    [OUT, "signing-in", "Connecting to Swedebeat…"],
    [mv({ signingOut: true }), "none", "Signing out of Swedebeat"],
    [MIX_DISABLED, "none", "Swedebeat playback is off"],
    [mv({ keychainUsable: false }), "none", "Swedebeat cannot be connected here"],
  ];
  for (const [v, ui, text] of cases) assert.equal(head(v, ui).line?.text, text, text);
  const plates: [MixView, MixUi, string][] = [
    [mv({ state: "refused", refusal: "unavailable" }), "none", "Swedebeat could not be reached"],
    [mv({ needsReconnect: true }), "none", "Swedebeat needs you to connect again"],
    [mv({ state: "signed_in", fields: [] }), "ask", "Sign out of Swedebeat?"],
    [mv({ state: "refused", refusal: "bad_credentials" }), "form", "Swedebeat did not accept those details"],
    [mv({ state: "refused", refusal: "rate_limited" }), "form", "Too many tries"],
  ];
  for (const [v, ui, text] of plates) assert.equal(head(v, ui).plate?.headline, text, text);
});

test("no field is offered while the source is off, with no keychain, signed in or signing out", () => {
  assert.deepEqual(MIX_DISABLED.fields, []);
  for (const v of [MIX_DISABLED, mv({ keychainUsable: false }), mv({ state: "signed_in" }), mv({ signingOut: true }), mv({ fields: [] })]) {
    assert.equal(mayOfferSignIn(v), false);
    assert.equal(head(v, "form").form, null);
    assert.ok(!JSON.stringify(head(v, "none")).includes("mix-connect"));
  }
});

test("the form holds the source's fields, by name only, and says the password is not kept", () => {
  const f = head(OUT, "form").form;
  assert.deepEqual(f?.fields, [{ id: "username", label: "Username", secret: false }, { id: "password", label: "Password", secret: true }]);
  assert.equal(f?.fine, "Your password is not kept.");
  assert.deepEqual(f?.buttons.map((b) => b.id), ["mix-submit", "mix-cancel"]);
});

test("the line shows only with a Swedebeat class in the list; a refusal or reconnect shows always", () => {
  assert.equal(head(OUT, "none", false).line, null);
  assert.equal(head(MIX_DISABLED, "none", false).line, null);
  assert.notEqual(head(mv({ needsReconnect: true }), "none", false).plate, null);
});

test("rows and footer: Manual clock while not connected; nothing on the row while off; nothing when connected", () => {
  assert.deepEqual(rowMixOf(OUT), { marker: "away", text: "Manual clock" });
  assert.equal(rowMixOf(MIX_DISABLED), null);
  assert.equal(rowMixOf(mv({ state: "signed_in" })), null);
  assert.equal(footerReason(MIX_DISABLED), "Manual clock: Swedebeat playback is off");
  assert.equal(footerReason(mv({ state: "signed_in" })), null);
  const rows = [row("Sweat", 1, { source: "swedebeat" }), row("Climb", 2)];
  const s = screenOf(view({ rows, mix: OUT }), { ...UI, selectedId: rows[0]!.id }, NOW);
  assert.equal(s.mixLine?.text, "Swedebeat is not connected");
  assert.deepEqual(s.body.kind === "list" ? s.body.rows.map((r) => r.mix) : null, [{ marker: "away", text: "Manual clock" }, null]);
  assert.match(s.body.kind === "list" ? s.body.footer.detail : "", /Manual clock: Swedebeat is not connected$/);
  const form = screenOf(view({ rows, mix: OUT }), { ...UI, mix: "form" }, NOW);
  assert.equal(form.body.kind, "mix-form");
});

test("each sign-in field comes from a template that the browser neither keeps nor suggests, capped at 256", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { REPO } = await import("./fixtures.ts");
  const html = readFileSync(join(REPO, "player", "app", "src", "renderer", "classlist.html"), "utf8");
  const tpl = html.match(/<template id="mix-field">(<input [^>]*>)<\/template>/)?.[1] ?? "";
  for (const attr of ['autocomplete="off"', 'autocapitalize="off"', 'spellcheck="false"', 'maxlength="256"']) assert.ok(tpl.includes(attr), attr);
});

// #724: with 8 or more classes the filter stays under the two Swedebeat fault plates and steps
// aside only for a file's error plate or a form's note. The plate's one-line detail is the
// fallback the window uses when four whole rows would not fit.
const TWELVE = Array.from({ length: 12 }, (_, i) => row(`Class ${String(i).padStart(2, "0")}`, i + 1, { source: i < 2 ? "swedebeat" : "spotify" }));
const shotView = (mix: MixView, rows = TWELVE) => view({ rows, mix });

test("the class filter stays under the could-not-be-reached and connect-again plates (#724)", () => {
  for (const mix of [mv({ state: "refused", refusal: "unavailable" }), mv({ needsReconnect: true })]) {
    const s = screenOf(shotView(mix), { ...UI, filter: "class 03" }, NOW);
    assert.ok(s.mixPlate !== null);
    assert.deepEqual(s.filter, { of: "1 of 12" });
    assert.equal(s.body.kind, "list");
  }
});

test("the filter needs eight classes under a fault plate too (#724)", () => {
  const s = screenOf(shotView(mv({ needsReconnect: true }), TWELVE.slice(0, 7)), UI, NOW);
  assert.ok(s.mixPlate !== null);
  assert.equal(s.filter, null);
});

test("the filter still steps aside for a form and its note, and for a file's error plate (#724)", () => {
  const form = screenOf(shotView(mv({ state: "refused", refusal: "bad_credentials" })), { ...UI, mix: "form", filter: "class" }, NOW);
  assert.equal(form.body.kind, "mix-form");
  assert.equal(form.filter, null);
  const error = { message: "m", fileName: "x.json", details: [] };
  const file = screenOf(view({ rows: TWELVE, mix: mv({ needsReconnect: true }), fileError: error }), UI, NOW);
  assert.equal(file.filter, null);
});

test("a fault plate has no dismiss key, and its own key is the way back to the form (#724)", () => {
  for (const [mix, label] of [[mv({ state: "refused", refusal: "unavailable" }), "Try again"], [mv({ needsReconnect: true }), "Connect Swedebeat again"]] as const) {
    const p = head(mix).plate;
    assert.deepEqual(p?.buttons.map((b) => b.label), [label]);
  }
});

test("a fault plate carries a one-line detail for a window too short for four rows (#724)", () => {
  const unreachable = head(mv({ state: "refused", refusal: "unavailable" })).plate;
  assert.equal(unreachable?.short, "Check the connection, then try again.");
  assert.ok(unreachable?.detail.startsWith(unreachable.short ?? "?"));
  const reconnect = head(mv({ needsReconnect: true })).plate;
  assert.equal(reconnect?.short, "The mixes saved on this computer are kept.");
  assert.ok(reconnect?.detail.startsWith(reconnect.short ?? "?"));
  assert.equal(head(mv({ state: "signed_in", fields: [] }), "ask").plate?.short, null);
});

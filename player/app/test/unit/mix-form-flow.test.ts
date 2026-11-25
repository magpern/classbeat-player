// The Swedebeat sign-in form on the class list (issue #709, items 3 and 4): an empty field keeps
// the form open and says which, no answer from the shell keeps it open and says nothing was sent,
// and a call that fails never leaves the page on "One moment".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { screenOf } from "../../src/core/list/screen.ts";
import type { ListUi, ListView } from "../../src/core/list/view.ts";
import { missingNote, noteWords } from "../../src/core/mix/form-note.ts";
import type { FormNote } from "../../src/core/mix/form-note.ts";
import { mixHeadOf } from "../../src/core/mix/list-model.ts";
import type { MixUi } from "../../src/core/mix/list-model.ts";
import { fieldsView, MIX_DISABLED } from "../../src/core/mix/view.ts";
import type { MixView } from "../../src/core/mix/view.ts";
import { mixFlow } from "../../src/renderer/mix-flow.ts";
import { REPO } from "./fixtures.ts";
import { NOW, view } from "./list-fixtures.ts";

const FIELDS = fieldsView([{ name: "username", secret: false }, { name: "password", secret: true }]);
const OUT: MixView = { ...MIX_DISABLED, state: "signed_out", fields: FIELDS };
const TYPED = { username: "ana.k", password: "SENTINEL-pw-7f3a9c" };
const listView = (mix: Partial<MixView>): ListView => view({ mix: { ...OUT, ...mix } });

describe("what the form says", () => {
  it("names the fields left empty, in the form's order, and nothing when all are filled", () => {
    assert.deepEqual(missingNote(FIELDS, new Set(["password"])), { kind: "missing", labels: ["Password"] });
    assert.deepEqual(missingNote(FIELDS, new Set(["password", "username"])), { kind: "missing", labels: ["Username", "Password"] });
    assert.equal(missingNote(FIELDS, new Set()), null);
    assert.equal(missingNote(FIELDS, new Set(["other"])), null);
    assert.equal(noteWords({ kind: "missing", labels: ["Username", "Password"] }).headline, "Type your username and password");
    assert.equal(noteWords({ kind: "missing", labels: ["A", "B", "C"] }).headline, "Type your a, b and c");
  });

  it("shows the note as a plate over the open form, newer than a refusal, and the screen announces it", () => {
    for (const note of [{ kind: "missing", labels: ["Password"] }, { kind: "not_taken" }, { kind: "failed" }] as FormNote[]) {
      const h = mixHeadOf(OUT, "form", true, note);
      assert.equal(h.plate?.headline, noteWords(note).headline);
      assert.notEqual(h.form, null, "the form stays open");
      const refused = mixHeadOf({ ...OUT, state: "refused", refusal: "bad_credentials" }, "form", true, note);
      assert.equal(refused.plate?.headline, noteWords(note).headline);
      const ui: ListUi = { filter: "", selectedId: null, lastStartedId: null, mix: "form", mixNote: note };
      const s = screenOf(listView({}), ui, NOW);
      assert.equal(s.announce, noteWords(note).headline);
      assert.equal(s.body.kind, "mix-form");
    }
  });

  it("keeps the form that was shown, so the fields already filled in are not repainted empty", () => {
    const note: FormNote = { kind: "missing", labels: ["Password"] };
    assert.deepEqual(mixHeadOf(OUT, "form", true, note).form, mixHeadOf(OUT, "form", true).form);
    const refused: MixView = { ...OUT, state: "refused", refusal: "rate_limited" };
    assert.deepEqual(mixHeadOf(refused, "form", true, note).form, mixHeadOf(refused, "form", true).form);
  });

  it("shows no note once the form is closed", () => {
    assert.equal(mixHeadOf(OUT, "none", true, { kind: "failed" }).plate, null);
  });
});

/** The flow with recording ports; `answer` is what the shell's call settles with. */
function rig(answer: () => Promise<ListView | null>, empty: string[] = []) {
  const log: string[] = [];
  const shown: { mix: MixUi; note: FormNote | null }[] = [];
  let mix: MixUi = "form";
  const act = mixFlow({
    mix: () => mix,
    fields: () => FIELDS,
    emptyFields: () => new Set(empty),
    takeTyped: () => {
      log.push("takeTyped");
      return { ...TYPED };
    },
    clearTyped: () => log.push("clearTyped"),
    set: (m, note) => {
      mix = m;
      shown.push({ mix: m, note });
    },
    signIn: () => {
      log.push("signIn");
      return answer();
    },
    signOut: () => {
      log.push("signOut");
      return answer();
    },
    take: (v) => log.push(`take ${v === null ? "null" : v.mix.state}`),
    refresh: () => log.push("refresh"),
  });
  return { act, log, shown, last: () => shown[shown.length - 1] };
}
const settle = () => new Promise((r) => setImmediate(r));

describe("the form's flow", () => {
  it("an empty field keeps the form open, says which, and neither reads nor sends anything", () => {
    const r = rig(() => Promise.resolve(listView({ state: "signed_in" })), ["password"]);
    r.act("mix-submit");
    assert.deepEqual(r.log, []);
    assert.deepEqual(r.last(), { mix: "form", note: { kind: "missing", labels: ["Password"] } });
  });

  it("no answer from the shell keeps the form open and says the details were not sent", async () => {
    const r = rig(() => Promise.resolve(null));
    r.act("mix-submit");
    assert.equal(r.last()?.mix, "signing-in");
    await settle();
    assert.deepEqual(r.last(), { mix: "form", note: { kind: "not_taken" } });
    assert.deepEqual(r.log, ["takeTyped", "signIn", "take null"]);
  });

  it("a refusal of the details keeps the form without a note; a connection closes it", async () => {
    const refused = rig(() => Promise.resolve(listView({ state: "refused", refusal: "bad_credentials" })));
    refused.act("mix-submit");
    await settle();
    assert.deepEqual(refused.last(), { mix: "form", note: null });
    const done = rig(() => Promise.resolve(listView({ state: "signed_in" })));
    done.act("mix-submit");
    await settle();
    assert.deepEqual(done.last(), { mix: "none", note: null });
  });

  it("a sign-in call that fails leaves \"One moment\", says so, and reads the shell again", async () => {
    const r = rig(() => Promise.reject(new Error("bridge gone")));
    r.act("mix-submit");
    await settle();
    assert.deepEqual(r.last(), { mix: "form", note: { kind: "failed" } });
    assert.deepEqual(r.log, ["takeTyped", "signIn", "refresh"]);
  });

  it("a sign-out call that fails leaves \"One moment\" and reads the shell again", async () => {
    const r = rig(() => Promise.reject(new Error("bridge gone")));
    r.act("mix-sign-out-yes");
    assert.equal(r.last()?.mix, "signing-out");
    await settle();
    assert.deepEqual(r.last(), { mix: "none", note: null });
    assert.deepEqual(r.log, ["signOut", "refresh"]);
  });

  it("opening, cancelling and the sign-out question clear the note", () => {
    const r = rig(() => Promise.resolve(null));
    r.act("mix-cancel");
    assert.deepEqual(r.last(), { mix: "none", note: null });
    assert.deepEqual(r.log, ["clearTyped"]);
    r.act("mix-connect");
    assert.deepEqual(r.last(), { mix: "form", note: null });
    r.act("mix-sign-out");
    assert.deepEqual(r.last(), { mix: "ask", note: null });
  });
});

describe("the class list page uses the flow", () => {
  const file = join(REPO, "player/app/src/renderer/classlist.ts");
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, walk);
  };
  walk(src);
  const callee = (c: ts.CallExpression): string => c.expression.getText(src);

  it("builds its Swedebeat actions with mixFlow", () => {
    assert.equal(calls.filter((c) => callee(c) === "mixFlow").length, 1);
  });

  it("never chains on the sign-in or sign-out call itself, where a rejection would go unhandled", () => {
    const chained = calls.filter((c) => ts.isPropertyAccessExpression(c.expression) && ts.isCallExpression(c.expression.expression) && /mixSign(In|Out)$/.test(callee(c.expression.expression)));
    assert.deepEqual(chained.map((c) => c.getText(src)), []);
  });
});

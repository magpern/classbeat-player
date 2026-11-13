// Getting control (docs/design/companion.md, "Getting control"): the codes the page reads and
// types, what each way in sends, and the words for every error name of the contract.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_NAMES } from "../../src/companion/core/answer.ts";
import type { Outcome } from "../../src/companion/core/answer.ts";
import { normaliseCode, parseFragment, shownWhileTyping } from "../../src/companion/core/codes.ts";
import { ERROR_WORDS, WORDS, answered, initialEntry, submit, typed } from "../../src/companion/core/entry.ts";
import type { Entry } from "../../src/companion/core/entry.ts";
import { SECRET43, schemaEnum } from "../lib/live-examples.ts";

const TOKEN = `cbp_ctl_${SECRET43}`;

describe("companion codes", () => {
  it("normalises a typed code to XXXX-XXXX of the alphabet, or refuses it", () => {
    assert.equal(normaliseCode("bcdf ghjk"), "BCDF-GHJK");
    assert.equal(normaliseCode("BCDF-GHJK"), "BCDF-GHJK");
    assert.equal(normaliseCode("bcdfghjk"), "BCDF-GHJK");
    for (const bad of ["", "BCDF-GHJ", "BCDF-GHJKL", "ABCD-EFGH", "BCDF-GHJ1", "BCDF_GHJK", "B".repeat(41)]) assert.equal(normaliseCode(bad), null, bad);
  });

  it("reads #<join> and #<join>.<control>; anything else gives nothing", () => {
    assert.deepEqual(parseFragment("#BCDF-GHJK"), { join: "BCDF-GHJK", control: null });
    assert.deepEqual(parseFragment("#bcdf-ghjk.lmnp-qrst"), { join: "BCDF-GHJK", control: "LMNP-QRST" });
    assert.deepEqual(parseFragment("#BCDF-GHJK.nope"), { join: "BCDF-GHJK", control: null });
    for (const bad of ["", "#", "#nope", "#.LMNP-QRST", "#BCDF-GHJK.LMNP-QRST.X", "#%E0%A4%A", `#${"B".repeat(41)}`, `#${TOKEN}`]) assert.deepEqual(parseFragment(bad), { join: null, control: null }, bad);
  });

  it("shows a code while typing: upper case, 8 letters, a hyphen after four", () => {
    assert.equal(shownWhileTyping("bcd"), "BCD");
    assert.equal(shownWhileTyping("bcdfg"), "BCDF-G");
    assert.equal(shownWhileTyping("bcdf-ghjkxx"), "BCDF-GHJK");
  });
});

const signedIn = (e: Entry): Entry => ({ ...e, signedIn: true });

describe("companion entry: the two ways in", () => {
  it("#<join> only fills the class code; it never sends anything by itself (rule 14)", () => {
    const e = initialEntry("BCDF-GHJK");
    assert.equal(e.classCode, "BCDF-GHJK");
    assert.equal(e.controlCode, "");
    assert.equal(e.busy, null);
  });

  it("by sign-in: not signed in opens the sign-in page and sends nothing", () => {
    const r = submit(initialEntry("BCDF-GHJK"), "sign_in");
    assert.ok("signIn" in r);
    assert.ok(!("send" in r));
  });

  it("by sign-in: signed in, the class code goes to /api/live/controller and nothing else", () => {
    const r = submit(signedIn(initialEntry("bcdf ghjk")), "sign_in");
    assert.ok("send" in r);
    assert.deepEqual(r.send, { route: "controller", body: { session: "BCDF-GHJK" } });
    assert.equal(r.entry.busy, "sign_in");
    // A second press while the first is out sends nothing.
    assert.ok(!("send" in submit(r.entry, "sign_in")));
  });

  it("by control code: both codes go to /api/live/control", () => {
    const e = typed(initialEntry("BCDF-GHJK"), "control", "lmnpqrst");
    const r = submit(e, "code");
    assert.ok("send" in r);
    assert.deepEqual(r.send, { route: "control", body: { session: "BCDF-GHJK", code: "LMNP-QRST" } });
  });

  it("a code that is not 8 letters says so under its field and sends nothing", () => {
    const a = submit(signedIn(initialEntry(null)), "sign_in");
    assert.deepEqual(a.entry.error, { field: "class", text: WORDS.form });
    const b = submit(typed(initialEntry("BCDF-GHJK"), "control", "LMN"), "code");
    assert.deepEqual(b.entry.error, { field: "control", text: WORDS.form });
    assert.ok(!("send" in a) && !("send" in b));
  });

  it("typing takes its own field's error away, not the other's", () => {
    const e: Entry = { ...initialEntry(null), error: { field: "control", text: "x" } };
    assert.deepEqual(typed(e, "class", "B").error, e.error);
    assert.equal(typed(e, "control", "B").error, null);
  });
});

describe("companion entry: every answer", () => {
  const busy = (way: "sign_in" | "code"): Entry => ({ ...initialEntry("BCDF-GHJK"), controlCode: "LMNP-QRST", busy: way, signedIn: way === "sign_in" });

  it("a token is handed on, and the page is idle again", () => {
    const a = answered(busy("code"), "code", { kind: "token", token: TOKEN });
    assert.equal(a.token, TOKEN);
    assert.equal(a.entry.busy, null);
    assert.equal(a.entry.error, null);
  });

  it("every error name of error.schema.json has words, and they never say whether the class exists", () => {
    assert.deepEqual(Object.keys(ERROR_WORDS).sort(), [...(schemaEnum("error", "properties/error") as string[])].sort());
    for (const name of ERROR_NAMES) {
      assert.ok(ERROR_WORDS[name].length > 0, name);
      assert.doesNotMatch(ERROR_WORDS[name], /no such|not found|does not exist|unknown/i, name);
    }
    assert.equal(ERROR_WORDS.invalid_code, WORDS.codeWrong);
    assert.equal(ERROR_WORDS.cannot_control, WORDS.signInWrong);
    assert.equal(ERROR_WORDS.too_many_requests, WORDS.tooMany);
    assert.equal(ERROR_WORDS.invalid_request, WORDS.wentWrong);
    assert.equal(ERROR_WORDS.internal_error, WORDS.wentWrong);
  });

  it("each refusal shows its words under the field of the way used, the codes kept", () => {
    for (const error of ERROR_NAMES) {
      if (error === "controllers_full") continue;
      for (const way of ["sign_in", "code"] as const) {
        const a = answered(busy(way), way, { kind: "refused", error });
        assert.deepEqual(a.entry.error, { field: way === "code" ? "control" : "class", text: ERROR_WORDS[error] }, `${way} ${error}`);
        assert.equal(a.entry.classCode, "BCDF-GHJK");
        assert.equal(a.token, undefined);
      }
    }
  });

  it("controllers_full: the two-phones page, the class code kept and the control code cleared", () => {
    const a = answered(busy("code"), "code", { kind: "refused", error: "controllers_full" });
    assert.equal(a.entry.full, true);
    assert.equal(a.entry.classCode, "BCDF-GHJK");
    assert.equal(a.entry.controlCode, "");
    assert.equal(a.entry.error, null);
  });

  it("no answer, or one off the contract, has its own words", () => {
    const cases: [Outcome, string][] = [
      [{ kind: "unreachable" }, WORDS.unreachable],
      [{ kind: "unexpected" }, WORDS.wentWrong],
    ];
    for (const [o, text] of cases) assert.equal(answered(busy("code"), "code", o).entry.error?.text, text);
  });
});

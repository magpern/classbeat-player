// The pairing page's pure rules (src/site/core/pairing-model.ts; ADR 0002, section 6): the local
// code check is never more lenient than the backend's, every refusal of a code is one answer,
// and nothing is approved but by the decision the person pressed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Answer } from "../../src/site/core/answer.ts";
import { afterDecide, afterFind, CODE_ALPHABET, CODE_INPUT_MAX, CODE_LENGTH, codeOf, continueWith, NAME_MAX, nameOf, pairPlateWords, prefillName, showCode } from "../../src/site/core/pairing-model.ts";
import type { PairView } from "../../src/site/core/pairing-model.ts";
import { impurities } from "../lib/core-purity.ts";

const backend = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../../backend/src/player_backend/${rel}`, import.meta.url)), "utf8");
const constant = (src: string, name: string): string => {
  const m = new RegExp(`^${name}: Final = (.+)$`, "m").exec(src);
  assert.ok(m, `${name} not found`);
  return m[1].trim();
};

/** The backend's `normalise_code` as written there: Python's str.upper(), which is wider than ASCII. */
function backendCode(raw: string): string | null {
  if ([...raw].length > CODE_INPUT_MAX) return null;
  const letters = raw.replaceAll(" ", "").replaceAll("-", "").toUpperCase();
  return [...letters].length === CODE_LENGTH && [...letters].every((c) => CODE_ALPHABET.includes(c)) ? letters : null;
}

const ok = (body: unknown, status = 200): Answer => ({ kind: "ok", status, body });
const refused = (status: number, code: string): Answer => ({ kind: "refused", status, code });
const FOUND: Extract<PairView, { screen: "found" }> = { screen: "found", code: "BCDFGHJK", platform: "macOS", version: "0.4.0", name: "macOS computer" };

describe("the code's shape", () => {
  it("is the backend's (code_policy.py)", () => {
    const src = backend("code_policy.py");
    assert.equal(constant(src, "ALPHABET"), `"${CODE_ALPHABET}"`);
    assert.equal(constant(src, "LENGTH"), String(CODE_LENGTH));
    assert.equal(constant(src, "INPUT_MAX"), String(CODE_INPUT_MAX));
    assert.equal(constant(backend("pairing_policy.py"), "LABEL_MAX"), String(NAME_MAX));
  });

  const cases: [string, string | null][] = [
    ["BCDFGHJK", "BCDFGHJK"],
    ["bcdf-ghjk", "BCDFGHJK"],
    ["BCDF GHJK", "BCDFGHJK"],
    [" b-c-d-f g h j k ", "BCDFGHJK"],
    ["--bcdfghjk--", "BCDFGHJK"],
    ["ZXWV-TSRQ", "ZXWVTSRQ"],
    ["", null],
    ["BCDF-GHJ", null],
    ["BCDF-GHJKL", null],
    ["ABCD-EFGH", null],
    ["BCDF-GHJ1", null],
    ["BCDF_GHJK", null],
    ["BCDF\tGHJK", null],
    ["BCDF GHJK", null],
    ["ＢCDF-GHJK", null],
    // Python's upper() makes U+017F "S"; the page refuses it, which is stricter, never wider.
    ["ſCDF-GHJK", null],
    [`BCDFGHJK${" ".repeat(32)}`, "BCDFGHJK"],
    [`BCDFGHJK${" ".repeat(33)}`, null],
  ];
  for (const [typed, want] of cases) {
    it(`reads ${JSON.stringify(typed)} as ${want}`, () => {
      assert.equal(codeOf(typed), want);
    });
  }

  it("never accepts what the backend refuses, and sends what the backend would look up", () => {
    const pieces = ["", " ", "-", "b", "B", "a", "1", "_", " ", "ſ", "ﬀ", "ı", "​", "x", "Z", "k", "K"];
    const typed = new Set<string>(cases.map(([t]) => t));
    for (const a of pieces) for (const b of pieces) for (const c of pieces) typed.add(`BCD${a}FGH${b}J${c}`);
    for (const t of typed) {
      const local = codeOf(t);
      if (local !== null) assert.equal(backendCode(t), local, JSON.stringify(t));
    }
  });

  it("is shown in the BCDF-GHJK style", () => {
    assert.equal(showCode("BCDFGHJK"), "BCDF-GHJK");
  });

  it("is checked before anything is sent: not a code is the field error, with the typed text kept", () => {
    assert.deepEqual(continueWith("BCDF-GH"), { view: { screen: "enter", typed: "BCDF-GH", codeError: true } });
    assert.deepEqual(continueWith("bcdf ghjk"), { code: "BCDFGHJK" });
  });
});

describe("the name", () => {
  it("is 1 to 40 characters once trimmed, counted as characters", () => {
    assert.equal(nameOf("  Studio PC "), "Studio PC");
    assert.equal(nameOf(""), null);
    assert.equal(nameOf("   "), null);
    assert.equal(nameOf("x".repeat(40)), "x".repeat(40));
    assert.equal(nameOf("x".repeat(41)), null);
    assert.equal(nameOf("🚲".repeat(40)), "🚲".repeat(40));
  });

  it("is prefilled with the platform's name", () => {
    assert.equal(prefillName("macOS"), "macOS computer");
    assert.equal(prefillName("Windows"), "Windows computer");
    assert.equal(prefillName("p".repeat(40)), "p".repeat(40));
    assert.ok([...prefillName("p".repeat(35))].length <= NAME_MAX);
  });
});

describe("after the look-up", () => {
  it("shows who asks, with the name prefilled", () => {
    assert.deepEqual(afterFind("bcdf-ghjk", "BCDFGHJK", ok({ platform: "macOS", version: "0.4.0" })), FOUND);
  });

  it("one answer for every refusal, keeping what was typed", () => {
    assert.deepEqual(afterFind("BCDF-GHJL", "BCDFGHJL", refused(404, "pairing_not_found")), { screen: "enter", typed: "BCDF-GHJL", plate: { kind: "not-found" } });
    // Whatever the 404 says, it is the same answer.
    assert.deepEqual(afterFind("BCDF-GHJL", "BCDFGHJL", refused(404, "not_found")), afterFind("BCDF-GHJL", "BCDFGHJL", refused(404, "pairing_not_found")));
  });

  it("the route's 422 is 'not a code'", () => {
    assert.deepEqual(afterFind("BCDFGHJK", "BCDFGHJK", refused(422, "invalid_code")), { screen: "enter", typed: "BCDFGHJK", codeError: true });
  });

  it("errors, the session and a body it does not understand", () => {
    assert.deepEqual(afterFind("x", "BCDFGHJK", { kind: "not_signed_in" }), { screen: "ended" });
    assert.deepEqual(afterFind("x", "BCDFGHJK", { kind: "offline" }), { screen: "enter", typed: "x", plate: { kind: "offline" } });
    assert.deepEqual(afterFind("x", "BCDFGHJK", { kind: "too_many", retryAfter: 60 }), { screen: "enter", typed: "x", plate: { kind: "too-many", retryAfter: 60 } });
    assert.deepEqual(afterFind("x", "BCDFGHJK", ok({ platform: "macOS" })), { screen: "enter", typed: "x", plate: { kind: "server" } });
    assert.deepEqual(afterFind("x", "BCDFGHJK", ok(null)), { screen: "enter", typed: "x", plate: { kind: "server" } });
  });
});

describe("after the decision", () => {
  it("approved and denied only as pressed and as answered", () => {
    assert.deepEqual(afterDecide(FOUND, true, "Studio PC", ok({ status: "approved" })), { screen: "approved", name: "Studio PC" });
    assert.deepEqual(afterDecide(FOUND, false, "x", ok({ status: "denied" })), { screen: "denied" });
    // An answer that does not match the press is not taken as a result.
    assert.equal(afterDecide(FOUND, true, "Studio PC", ok({ status: "denied" })).screen, "found");
    assert.equal(afterDecide(FOUND, false, "x", ok({ status: "approved" })).screen, "found");
  });

  it("too many devices, a name not valid, and a pairing gone", () => {
    assert.deepEqual(afterDecide(FOUND, true, "Studio PC", refused(409, "too_many_devices")), { screen: "limit" });
    assert.deepEqual(afterDecide(FOUND, true, "bad", refused(422, "invalid_name")), { ...FOUND, name: "bad", nameError: true });
    assert.deepEqual(afterDecide(FOUND, true, "Studio PC", refused(404, "pairing_not_found")), { screen: "enter", typed: "BCDF-GHJK", plate: { kind: "not-found" } });
    assert.deepEqual(afterDecide(FOUND, false, "x", refused(404, "pairing_not_found")), { screen: "enter", typed: "BCDF-GHJK", plate: { kind: "not-found" } });
  });

  it("a fault keeps the question, with a plate", () => {
    for (const a of [{ kind: "offline" }, { kind: "server" }, refused(400, "invalid_request")] as Answer[]) {
      const next = afterDecide(FOUND, true, "Studio PC", a);
      assert.equal(next.screen, "found");
    }
    assert.deepEqual(afterDecide(FOUND, true, "x", { kind: "not_signed_in" }), { screen: "ended" });
  });
});

describe("the words", () => {
  it("not found names the limits and counts nothing", () => {
    const w = pairPlateWords({ kind: "not-found" });
    assert.equal(w.head, "That code was not found");
    assert.match(w.detail, /10 minutes/);
    assert.match(w.detail, /five wrong codes in a row this page closes for 15 minutes/);
    assert.doesNotMatch(w.detail, /\d+ (tries|attempts) left/);
  });
});

describe("purity", () => {
  it("the pairing and devices models import no I/O", () => {
    for (const f of ["pairing-model.ts", "devices-model.ts"]) {
      const path = fileURLToPath(new URL(`../../src/site/core/${f}`, import.meta.url));
      assert.deepEqual(impurities(path, readFileSync(path, "utf8")), [], f);
    }
  });
});

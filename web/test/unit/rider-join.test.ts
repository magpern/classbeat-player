// The join form (docs/design/rider.md, "Getting in", "Fields and limits", "Before and while
// joining"): the page's own checks, the body Join sends (exactly `session` and `nickname`: never
// the FTP or the maximum heart rate, ADR 0007 section 1) and what each answer of the join route
// shows. The contract's recorded examples run through the same code.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIELD_WORDS, checkFtp, checkHrmax, checkNickname, codePoints, parseRemembered, rememberedText } from "../../src/rider/core/fields.ts";
import { answered, awayForm, initialForm, outcomeOf, submit, typed } from "../../src/rider/core/join.ts";
import type { Form } from "../../src/rider/core/join.ts";
import { SECRET43, examples } from "../lib/live-examples.ts";

const fill = (f: Form, values: Partial<Record<"code" | "nickname" | "ftp" | "hrmax", string>>): Form =>
  Object.entries(values).reduce((g, [k, v]) => typed(g, k as "code", v), f);

const FTP = 287;
const HRMAX = 193;

describe("the rider's fields", () => {
  it("counts the nickname in code points, after trimming both ends", () => {
    assert.equal(codePoints("Anna"), 4);
    assert.equal(codePoints("🚴‍♀️"), 4); // a person on a bike, as ZWJ and variation selector: four code points
    assert.equal(codePoints("😀".repeat(24)), 24); // 48 UTF-16 units
    assert.equal(checkNickname("  Anna  "), "Anna");
    assert.equal(checkNickname("😀".repeat(24)), "😀".repeat(24));
    assert.equal(checkNickname("😀".repeat(25)), null);
    assert.equal(checkNickname("W".repeat(24)), "W".repeat(24));
    assert.equal(checkNickname("W".repeat(25)), null);
    assert.equal(checkNickname("   "), null);
    assert.equal(checkNickname(""), null);
  });

  it("takes whole numbers in range only, and an empty field as no number", () => {
    const table: readonly (readonly [string, number | null | "bad"])[] = [
      ["", null], ["  ", null], ["250", 250], [" 250 ", 250], ["50", 50], ["600", 600], ["49", "bad"], ["601", "bad"],
      ["2500", "bad"], ["99999", "bad"], ["25.5", "bad"], ["-250", "bad"], ["1e3", "bad"], ["0x10", "bad"], ["٢٥٠", "bad"], ["250W", "bad"],
    ];
    for (const [t, want] of table) assert.equal(checkFtp(t), want, JSON.stringify(t));
    assert.equal(checkHrmax("80"), 80);
    assert.equal(checkHrmax("230"), 230);
    assert.equal(checkHrmax("79"), "bad");
    assert.equal(checkHrmax("231"), "bad");
  });

  it("remembers exactly the two numbers and reads back only what it wrote", () => {
    assert.equal(rememberedText({ ftp: null, hrmax: null }), null);
    assert.equal(rememberedText({ ftp: 250, hrmax: null }), '{"ftp":250,"hrmax":null}');
    assert.deepEqual(parseRemembered('{"ftp":250,"hrmax":185}'), { ftp: 250, hrmax: 185 });
    assert.deepEqual(parseRemembered('{"hrmax":185,"ftp":null}'), { ftp: null, hrmax: 185 });
    for (const bad of [null, "", "x", "[]", "null", '{"ftp":250}', '{"ftp":250,"hrmax":185,"nickname":"Anna"}', '{"ftp":2500,"hrmax":185}', '{"ftp":"250","hrmax":185}', '{"ftp":null,"hrmax":null}', '{"ftp":250.5,"hrmax":185}']) {
      assert.equal(parseRemembered(bad), null, String(bad));
    }
  });
});

describe("the join form", () => {
  it("starts with Remember off and nothing filled, or the remembered numbers with Remember on", () => {
    const f = initialForm("KXPD-RMTB", true, null);
    assert.equal(f.remember, false);
    assert.equal(f.remembered, false);
    assert.deepEqual(f.typed, { code: "", nickname: "", ftp: "", hrmax: "" });
    const r = initialForm("KXPD-RMTB", true, { ftp: 250, hrmax: 185 });
    assert.equal(r.remember, true);
    assert.equal(r.remembered, true);
    assert.deepEqual(r.typed, { code: "", nickname: "", ftp: "250", hrmax: "185" });
  });

  it("sends exactly session and nickname: never the FTP or the maximum heart rate", () => {
    const f = fill(initialForm("KXPD-RMTB", true, null), { nickname: " Anna ", ftp: String(FTP), hrmax: String(HRMAX) });
    const r = submit(f);
    assert.ok("send" in r);
    assert.deepEqual(Object.keys(r.send).sort(), ["nickname", "session"]);
    assert.deepEqual(r.send, { session: "KXPD-RMTB", nickname: "Anna" });
    const body = JSON.stringify(r.send);
    assert.doesNotMatch(body, new RegExp(`${FTP}|${HRMAX}|ftp|hrmax|heart`, "i"));
    assert.deepEqual(r.numbers, { ftp: FTP, hrmax: HRMAX });
    assert.equal(r.form.busy, true);
    assert.equal(submit(r.form).form, r.form, "pressed twice: nothing more goes out");
  });

  it("normalises a typed code and catches one that is not 8 letters of the alphabet", () => {
    const ok = submit(fill(initialForm(null, true, null), { code: "kxpd rmtb", nickname: "Anna" }));
    assert.ok("send" in ok);
    assert.equal(ok.send.session, "KXPD-RMTB");
    assert.equal(ok.form.code, "KXPD-RMTB");
    for (const code of ["", "KXPD-RMT", "KXPD-RMTBB", "AEIO-UAEI", "KXPD-RMT1"]) {
      const bad = submit(fill(initialForm(null, true, null), { code, nickname: "Anna" }));
      assert.ok(!("send" in bad), code);
      assert.equal(bad.form.errors.code, FIELD_WORDS.code);
    }
  });

  it("refuses a bad field with its words, keeps what was typed and sends nothing", () => {
    const f = fill(initialForm("KXPD-RMTB", true, null), { nickname: "", ftp: "2500", hrmax: "185" });
    const r = submit(f);
    assert.ok(!("send" in r));
    assert.deepEqual(r.form.errors, { nickname: FIELD_WORDS.nickname, ftp: FIELD_WORDS.ftp });
    assert.equal(r.form.typed.ftp, "2500");
    assert.equal(r.form.busy, false);
    const again = typed(r.form, "ftp", "250");
    assert.deepEqual(again.errors, { nickname: FIELD_WORDS.nickname }, "typing takes that field's error away only");
  });

  it("every valid join request of the contract is what the form sends for it", () => {
    for (const ex of examples("join-request", "valid")) {
      const v = ex.value as { session: string; nickname: string };
      const r = submit(fill(initialForm(v.session, true, null), { nickname: v.nickname }));
      assert.ok("send" in r, ex.name);
      assert.deepEqual(r.send, v, ex.name);
    }
  });

  it("no invalid join request of the contract can come out of the form", () => {
    for (const ex of examples("join-request", "invalid")) {
      const v = ex.value as Record<string, unknown>;
      const r = submit(fill(initialForm(typeof v.session === "string" ? v.session : null, true, null), { nickname: typeof v.nickname === "string" ? v.nickname : "", ftp: "250", hrmax: "185" }));
      if ("send" in r) assert.notDeepEqual(r.send, v, ex.name);
    }
  });
});

describe("the join answers", () => {
  const busy = (): Form => {
    const r = submit(fill(initialForm("KXPD-RMTB", true, null), { nickname: "Anna" }));
    assert.ok("send" in r);
    return r.form;
  };

  it("takes a token only from a 200 that is exactly the contract's answer", () => {
    for (const ex of examples("join-answer", "valid")) {
      const o = outcomeOf({ kind: "answer", status: 200, body: ex.value });
      assert.deepEqual(o, { kind: "token", token: `cbp_rdr_${SECRET43}` }, ex.name);
    }
    for (const ex of examples("join-answer", "invalid")) assert.equal(outcomeOf({ kind: "answer", status: 200, body: ex.value }).kind, "unexpected", ex.name);
    assert.equal(outcomeOf({ kind: "answer", status: 200, body: null }).kind, "unexpected");
  });

  it("shows one page for every cannot_join, a plate for too many tries and for the rest, and No connection", () => {
    const f = busy();
    const at = (status: number, body: unknown): ReturnType<typeof answered> => answered(f, outcomeOf({ kind: "answer", status, body }));
    assert.equal(at(403, { error: "cannot_join" }).next, "not_joined");
    assert.equal(at(404, { error: "cannot_join" }).next, "not_joined");
    assert.deepEqual([at(429, null).next, at(429, null).form.plate], ["form", "too_many"]);
    assert.deepEqual([at(429, { error: "too_many_requests" }).next, at(429, { error: "too_many_requests" }).form.plate], ["form", "too_many"]);
    for (const error of ["invalid_request", "body_too_large", "internal_error"]) assert.equal(at(400, { error }).form.plate, "went_wrong", error);
    assert.equal(at(413, null).form.plate, "went_wrong");
    assert.equal(at(500, "<html>").form.plate, "went_wrong");
    const off = answered(f, outcomeOf({ kind: "unreachable" }));
    assert.equal(off.next, "no_connection");
    assert.equal(off.form.busy, false);
    assert.equal(at(403, { error: "cannot_join" }).form.typed.nickname, "Anna", "Try again keeps the values");
  });

  it("back on the form after the token lapsed: the plate, and what was typed kept", () => {
    const f = awayForm(busy());
    assert.equal(f.plate, "away");
    assert.equal(f.busy, false);
    assert.equal(f.typed.nickname, "Anna");
    assert.equal(f.code, "KXPD-RMTB");
  });
});

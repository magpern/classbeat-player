// The <meta> reader (test/lib/html-meta.ts) finds every policy the old pattern found, and the ones it
// missed (#378): other quotes, other letter case, spacing, an unquoted value, a value written with
// character references, a repeated attribute, a policy after a comment. And it reads nothing out of
// a comment or a script.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPolicyMeta, policyMetaCount, policyMetas, referrerMetas } from "../lib/html-meta.ts";

const page = (head: string): string => `<!doctype html><html><head>${head}</head><body></body></html>`;

/** What the old pattern found: the exact tag. */
const OLD = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">';

/** What it missed. */
const NEW: readonly (readonly [string, string])[] = [
  ["single quotes", "<meta http-equiv='Content-Security-Policy' content=\"default-src 'self'\">"],
  ["lower case", '<meta http-equiv="content-security-policy" content="default-src \'self\'">'],
  ["upper case attribute name", '<meta HTTP-EQUIV="Content-Security-Policy" content="default-src \'self\'">'],
  ["content first", '<meta content="default-src \'self\'" http-equiv="Content-Security-Policy">'],
  ["extra spacing", '<meta   http-equiv = "Content-Security-Policy"\n  content = "default-src \'self\'" >'],
  ["unquoted", "<meta http-equiv=Content-Security-Policy content=default-src>"],
  ["self-closed", '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'"/>'],
  ["decimal reference", '<meta http-equiv="Content&#45;Security-Policy" content="default-src \'self\'">'],
  ["hex reference", '<meta http-equiv="&#x43;ontent-Security-Policy" content="default-src \'self\'">'],
  ["named reference", '<meta http-equiv="Content&hyphen;Security&hyphen;Policy" content="default-src \'self\'">'],
  ["reference without semicolon", '<meta http-equiv="Content&#45Security-Policy" content="default-src \'self\'">'],
  ["a reference this reader does not know", '<meta http-equiv="Content&nosuchthing;Security-Policy" content="x">'],
  ["padded value", '<meta http-equiv=" Content-Security-Policy " content="x">'],
  ["after a comment", `<!-- <meta http-equiv="x"> -->${OLD}`],
  ["a first attribute that repeats", '<meta http-equiv="Content-Security-Policy" http-equiv="refresh" content="x">'],
];

describe("the meta reader", () => {
  it("finds the policy the old pattern found, with its content", () => {
    assert.deepEqual(policyMetas(page(OLD)), ["default-src 'self'"]);
    assert.ok(hasPolicyMeta(page(OLD)));
    assert.equal(policyMetaCount(page(OLD)), 1);
  });

  it("finds what the old pattern missed", () => {
    for (const [label, tag] of NEW) {
      assert.ok(hasPolicyMeta(page(tag)), label);
      assert.equal(policyMetaCount(page(tag)), 1, label);
    }
  });

  it("decodes the policy it finds", () => {
    assert.deepEqual(policyMetas(page('<meta http-equiv="Content&#45;Security-Policy" content="default-src &apos;self&apos;">')), ["default-src 'self'"]);
  });

  it("decodes decimal, hex and named references in the content", () => {
    assert.deepEqual(policyMetas(page('<meta http-equiv="Content-Security-Policy" content="default&hyphen;src &#x27;self&#39; &lt;">')), ["default-src 'self' <"]);
  });

  it("finds none where there is none, and none in a comment, a script or a title", () => {
    assert.ok(!hasPolicyMeta(page('<meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="5">')));
    assert.ok(!hasPolicyMeta(page(`<!-- a > ${OLD} --><title>${OLD}</title><script>var a = '${OLD}';</script><style>/* ${OLD} */</style>`)));
    assert.ok(!hasPolicyMeta(page("<p>http-equiv=Content-Security-Policy</p>")));
  });

  it("counts every policy: two are two", () => {
    assert.equal(policyMetaCount(page(OLD + OLD)), 2);
  });

  it("reads the referrer meta, however it is written", () => {
    assert.deepEqual(referrerMetas(page('<meta name="referrer" content="no-referrer">')), ["no-referrer"]);
    assert.deepEqual(referrerMetas(page("<meta content='no-referrer' NAME=Referrer>")), ["no-referrer"]);
    assert.deepEqual(referrerMetas(page('<meta name="referrer" content="&#110;o-referrer">')), ["no-referrer"]);
    assert.deepEqual(referrerMetas(page("")), []);
  });
});

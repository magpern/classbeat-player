// The fake's page headers (test/lib/site-files.ts): the page's CSP is set once, under one name, and
// no reply's own header can replace it or add a second one, whatever case its name is in (#422 N5).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withCsp } from "../lib/site-files.ts";

const CSP = "default-src 'self'";
const cspNames = (h: Record<string, string>): string[] => Object.keys(h).filter((k) => k.toLowerCase() === "content-security-policy");

describe("the page headers", () => {
  it("carry the page's CSP once, beside the reply's other headers", () => {
    assert.deepEqual(withCsp(CSP), { "Content-Security-Policy": CSP });
    const h = withCsp(CSP, { "Cache-Control": "no-store", "Retry-After": "300" });
    assert.deepEqual(h, { "Cache-Control": "no-store", "Retry-After": "300", "Content-Security-Policy": CSP });
    assert.deepEqual(cspNames(h), ["Content-Security-Policy"]);
  });

  for (const name of ["Content-Security-Policy", "content-security-policy", "CONTENT-SECURITY-POLICY", "Content-security-Policy"]) {
    it(`refuse a reply's own CSP header: ${name}`, () => {
      assert.throws(() => withCsp(CSP, { [name]: "default-src *" }), /may not set the page's CSP/);
    });
  }
});

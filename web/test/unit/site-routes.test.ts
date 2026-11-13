// The site's addresses and the way back after a sign-in (docs/design/site.md, "Pages and their
// addresses"): only a path of this site is ever returned to; no open redirect.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageOf, returnPathOf } from "../../src/site/core/routes.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("site addresses", () => {
  it("knows the table's pages and nothing else", () => {
    assert.equal(pageOf("/sign-in").kind, "sign-in");
    assert.deepEqual(pageOf("/"), { kind: "redirect", to: "/classes" });
    assert.deepEqual(pageOf("/account"), { kind: "redirect", to: "/account/sessions" });
    for (const p of ["/classes", `/classes/${ID}`, "/devices", "/pair", "/account/sessions", "/account/passkeys", "/account/links", "/account/data", "/link/source"]) {
      assert.equal(pageOf(p).kind, "signed-in", p);
    }
    for (const p of ["/classes/", "/classes/x", `/classes/${ID.toUpperCase()}`, "/account/other", "/account/constructor", "/account/__proto__", "/sign-in/", "/admin", "//classes"]) {
      assert.equal(pageOf(p).kind, "not-found", p);
    }
  });

  it("each signed-in page reads its own route first", () => {
    assert.deepEqual(pageOf(`/classes/${ID}`), { kind: "signed-in", title: "Class details", nav: "classes", load: `classes/${ID}` });
    assert.equal((pageOf("/account/passkeys") as { load: string }).load, "passkeys");
  });
});

describe("the way back after a sign-in", () => {
  it("returns to a signed-in page of this site, by path", () => {
    assert.equal(returnPathOf("/devices", ""), "/devices");
    assert.equal(returnPathOf(`/classes/${ID}`, ""), `/classes/${ID}`);
  });

  it("keeps the query of /pair and /link/source only", () => {
    assert.equal(returnPathOf("/link/source", "?source=classbeat&state=s1"), "/link/source?source=classbeat&state=s1");
    assert.equal(returnPathOf("/pair", "?x=1"), "/pair?x=1");
    assert.equal(returnPathOf("/devices", "?next=https://evil.example"), "/devices");
  });

  it("never returns to another site, a protocol-relative address or a page that is not signed in", () => {
    for (const [path, search] of [
      ["//evil.example/classes", ""],
      ["https://evil.example/classes", ""],
      ["/\\evil.example", ""],
      ["/sign-in", ""],
      ["/nowhere", ""],
      ["evil.example", ""],
      ["", ""],
    ]) {
      assert.equal(returnPathOf(path, search), null, `${path}${search}`);
    }
    // Whatever is returned starts with exactly one slash.
    for (const r of [returnPathOf("/pair", "?a=//b"), returnPathOf("/link/source", "?redirect_uri=https://x")]) {
      assert.ok(r && r.startsWith("/") && !r.startsWith("//"));
    }
  });

  it("drops a query that could end the path early", () => {
    assert.equal(returnPathOf("/pair", "?a=1#frag"), "/pair");
    assert.equal(returnPathOf("/pair", "?a=\\b"), "/pair");
  });
});

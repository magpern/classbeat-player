// The site's addresses and the way back after a sign-in (docs/design/site.md, "Pages and their
// addresses"): only a path of this site is ever returned to; no open redirect.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RETURN_ENTRIES, pageOf, returnEntryOf, returnPathOf, signInAddressFor } from "../../src/site/core/routes.ts";

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

describe("the way back to another page: the fixed table (issue #263)", () => {
  it("holds /control and nothing else", () => {
    assert.deepEqual({ ...RETURN_ENTRIES }, { control: "/control" });
    // The companion is not a page of the site: only the table's entry returns to it.
    assert.equal(pageOf("/control").kind, "not-found");
    assert.equal(returnPathOf("/control", ""), null);
  });

  it("asks for it in the fragment, with the class code at most", () => {
    assert.equal(signInAddressFor("control", null), "/sign-in#return=control");
    assert.equal(signInAddressFor("control", "BCDF-GHJK"), "/sign-in#return=control.BCDF-GHJK");
    // Anything that is not exactly a class code is left out, never passed on.
    for (const bad of ["bcdf-ghjk", "BCDF-GHJK.LMNP-QRST", "BCDFGHJK", "", "https://evil.example", "BCDF-GHJK#x", `cbp_ctl_${"A".repeat(43)}`]) {
      assert.equal(signInAddressFor("control", bad), "/sign-in#return=control", bad);
    }
    for (const address of [signInAddressFor("control", null), signInAddressFor("control", "BCDF-GHJK")]) {
      assert.ok(!address.includes("?"), "no query: the entry is never sent to a server");
    }
  });

  it("reads back exactly what the companion asks for", () => {
    assert.equal(returnEntryOf(signInAddressFor("control", null).slice("/sign-in".length)), "/control");
    assert.equal(returnEntryOf(signInAddressFor("control", "BCDF-GHJK").slice("/sign-in".length)), "/control#BCDF-GHJK");
  });

  it("falls back to the default for any other entry or address", () => {
    for (const hash of [
      "",
      "#",
      "#return=",
      "#return=classes",
      "#return=devices",
      "#return=constructor",
      "#return=__proto__",
      "#return=hasOwnProperty",
      "#return=CONTROL",
      "#return=control/",
      "#return=//evil.example",
      "#return=https://evil.example",
      "#return=/control",
      "#return=%2F%2Fevil.example",
      "#return=control.",
      "#return=control.bcdf-ghjk",
      "#return=control.BCDF-GHJK.LMNP-QRST",
      "#return=control.BCDF-GHJK#x",
      "#return=control.BCDF-GHJK?x=1",
      "#return=control.//evil.example",
      "#return=control.BCDF-GHJK\nx",
      "#return=control.AEIO-UAEI",
      "#next=control",
      "#control",
      "#xreturn=control",
      "#return=control&x=1",
      `#cbp_ml_${"A".repeat(43)}`,
    ]) {
      assert.equal(returnEntryOf(hash), null, hash);
    }
  });

  it("always gives /control, or /control with a class code in its fragment", () => {
    for (const hash of ["#return=control", "#return=control.BCDF-GHJK", "#return=control.ZZZZ-XXXX"]) {
      assert.match(returnEntryOf(hash) ?? "", /^\/control(#[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4})?$/, hash);
    }
  });
});

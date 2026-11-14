// The sign-in link's fragment with its return entry (ADR 0006, decision 4), and the fake
// backend's link request that makes such links (ADR 0006, decisions 1 and 3).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fragmentOf } from "../../src/site/core/link-token.ts";
import { entryBackOf, returnEntryOf } from "../../src/site/core/routes.ts";
import { linkRequest } from "../lib/site-mail.ts";

const TOKEN = `cbp_ml_${"Ab3_-".repeat(8)}xyz`;
const JOIN = "BCDF-GHJK";

describe("a link token followed by its return entry (ADR 0006, decision 4)", () => {
  it("reads the token alone as today, with no way back", () => {
    assert.deepEqual(fragmentOf(`#${TOKEN}`), { kind: "token", token: TOKEN });
    assert.deepEqual(fragmentOf(TOKEN), { kind: "token", token: TOKEN });
  });

  it("reads the token with &return=control and with &return=control.CODE", () => {
    assert.deepEqual(fragmentOf(`#${TOKEN}&return=control`), { kind: "token", token: TOKEN, back: { path: "/control", field: "control" } });
    assert.deepEqual(fragmentOf(`#${TOKEN}&return=control.${JOIN}`), { kind: "token", token: TOKEN, back: { path: `/control#${JOIN}`, field: `control.${JOIN}` } });
  });

  it("keeps the token and ignores a return part that returnEntryOf refuses", () => {
    const bad = ["", "classes", "__proto__", "Control", "control.", "control.bcdf-ghjk", "control.BCDFGHJK", "control.BCDF-GHJA", "control.BCDF-GHJK.LMNP-QRST", "control.%2F%2Fevil.example", "//evil.example", "https://evil.example/x", "/pair?code=AB12-CD34", "control#BCDF-GHJK", `control.${JOIN}&x=1`, `control.${JOIN} `];
    for (const part of bad) {
      assert.equal(returnEntryOf(`return=${part}`), null, part);
      assert.deepEqual(fragmentOf(`#${TOKEN}&return=${part}`), { kind: "token", token: TOKEN }, part);
    }
  });

  it("reads anything else after the token as broken", () => {
    for (const tail of ["x", "&", "&return", "&return:control", "&Return=control", "&ret=control", "&x=1&return=control", "?return=control", "#return=control", " &return=control", "&return=control".slice(1), "%26return=control"]) {
      assert.deepEqual(fragmentOf(`#${TOKEN}${tail}`), { kind: "broken" }, tail);
    }
  });

  it("reads a cut-short token as broken, with or without a return part", () => {
    for (const cut of [TOKEN.slice(0, 6), TOKEN.slice(0, 7), TOKEN.slice(0, 30), TOKEN.slice(0, 49)]) {
      assert.deepEqual(fragmentOf(`#${cut}`), { kind: "broken" }, cut);
      assert.deepEqual(fragmentOf(`#${cut}&return=control`), { kind: "broken" }, cut);
    }
  });

  it("reads an & inside the first 50 characters as broken", () => {
    for (const at of [7, 20, 49]) {
      const raw = `${TOKEN.slice(0, at)}&return=control.${JOIN}`;
      assert.deepEqual(fragmentOf(`#${raw}`), { kind: "broken" }, raw);
      const swapped = `${TOKEN.slice(0, at)}&${TOKEN.slice(at + 1)}`;
      assert.deepEqual(fragmentOf(`#${swapped}`), { kind: "broken" }, swapped);
    }
  });

  it("leaves #return=control.CODE with no token as today", () => {
    assert.deepEqual(fragmentOf(`#return=control.${JOIN}`), { kind: "none" });
    assert.deepEqual(entryBackOf(`#return=control.${JOIN}`), { path: `/control#${JOIN}`, field: `control.${JOIN}` });
    assert.deepEqual(entryBackOf("#return=control"), { path: "/control", field: "control" });
    assert.equal(entryBackOf("#return=classes"), null);
    assert.equal(entryBackOf(`#return=control.${JOIN.toLowerCase()}`), null);
  });

  it("names a way back only as an entry, never as a path of the site", () => {
    for (const hash of ["#return=/pair?code=AB12-CD34", "#return=/classes", "#return=pair", "#/pair?code=AB12-CD34"]) {
      assert.equal(entryBackOf(hash), null, hash);
      assert.deepEqual(fragmentOf(`#${TOKEN}&${hash.slice(1)}`), hash.startsWith("#return=") ? { kind: "token", token: TOKEN } : { kind: "broken" }, hash);
    }
  });
});

describe("the fake backend's link request (ADR 0006, decisions 1 and 3)", () => {
  const ask = (body: unknown): ReturnType<typeof linkRequest> => linkRequest("https://site.test", JSON.stringify(body));

  it("mails the plain link without return_to, or with it missing or null", () => {
    for (const body of [{ email: "ana@example.com" }, { email: "ana@example.com", return_to: null }]) {
      assert.deepEqual(ask(body), { status: 200, body: { status: "accepted" }, link: `https://site.test/sign-in#${TOKEN}` });
    }
  });

  it("mails the link with the entry after the token for an exact return_to", () => {
    assert.equal(ask({ email: "ana@example.com", return_to: "control" }).link, `https://site.test/sign-in#${TOKEN}&return=control`);
    assert.equal(ask({ email: "ana@example.com", return_to: `control.${JOIN}` }).link, `https://site.test/sign-in#${TOKEN}&return=control.${JOIN}`);
  });

  it("answers 422 invalid_return for any other value, and sends no mail", () => {
    for (const v of ["", "Control", "control.", "control.bcdf-ghjk", "control.BCDFGHJK", "control.BCDF GHJK", " control", "control.BCDF-GHJA", "/control", "/pair?code=AB12-CD34", "classes", 1, true, [], {}]) {
      assert.deepEqual(ask({ email: "ana@example.com", return_to: v }), { status: 422, body: { error: "invalid_return" } }, JSON.stringify(v));
    }
  });

  it("checks the email before return_to", () => {
    assert.deepEqual(ask({ email: "ana@example", return_to: "nope" }), { status: 422, body: { error: "invalid_email" } });
    assert.deepEqual(ask({ return_to: "control" }), { status: 422, body: { error: "invalid_email" } });
  });
});

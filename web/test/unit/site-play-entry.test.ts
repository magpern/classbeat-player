// The return entries `play` and `play.<class id>` (issue #396; ADR 0008, section 3, and ADR 0006,
// decisions 2 to 6): what `returnEntryOf` accepts, the entry a link request carries, and the
// sign-in address the web player page builds. Pure, table-driven. The accepted set equals the
// backend's `login_policy.RETURN_ENTRY` (a drift test below reads it).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entryBackOf, playSignInAddress, returnEntryOf, classIdOfPage } from "../../src/site/core/routes.ts";
import { fragmentOf } from "../../src/site/core/link-token.ts";
import { signInBackAddress } from "../../src/play/route.ts";
import { linkRequest } from "../lib/site-mail.ts";
import { LINK_TOKEN } from "../lib/site-states.ts";

const ID = "0b9f7a62-3c1d-4e58-9a07-5d2e8f41c6ab";

describe("returnEntryOf accepts play and play.<canonical lower-case uuid>", () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ["#return=play", "/play"],
    ["return=play", "/play"],
    [`#return=play.${ID}`, `/play#${ID}`],
    [`return=play.${ID}`, `/play#${ID}`],
    ["#return=play.00000000-0000-0000-0000-000000000000", "/play#00000000-0000-0000-0000-000000000000"],
    ["#return=control", "/control"],
    ["#return=control.BCDF-GHJK", "/control#BCDF-GHJK"],
  ];
  for (const [hash, path] of accepted) it(`${hash} -> ${path}`, () => assert.equal(returnEntryOf(hash), path));

  const rejected: readonly string[] = [
    "#return=PLAY",
    "#return=Play",
    "#return=play ",
    "#return= play",
    "#return=play/",
    "#return=/play",
    "#return=play.",
    "#return=play.#x",
    `#return=play.${ID.toUpperCase()}`,
    `#return=play.${ID.slice(0, 8).toUpperCase()}${ID.slice(8)}`,
    `#return=play.${ID} `,
    `#return=play. ${ID}`,
    `#return=play.${ID}\n`,
    `#return=play.${ID}x`,
    `#return=play.${ID}.${ID}`,
    `#return=play.${ID}#x`,
    `#return=play.${ID}?x=1`,
    `#return=play.${ID.replaceAll("-", "")}`,
    `#return=play.${ID.slice(0, -1)}`,
    `#return=play.${ID}0`,
    `#return=play.${ID.replace("a", "g")}`,
    `#return=play.{${ID}}`,
    `#return=play.urn:uuid:${ID}`,
    "#return=play.BCDF-GHJK",
    "#return=play.../x",
    "#return=play.//evil.example",
    "#return=play.https://evil.example",
    `#return=play.%2F${ID}`,
    "#return=play&x=1",
    "#return=play/play",
    "#return=play.constructor",
    "#return=control.00000000-0000-0000-0000-000000000000",
    `#return=control.${ID}`,
    `#return=playcontrol`,
    "#return=player",
    "#return=plays",
    "#xreturn=play",
    "#play",
    "#next=play",
  ];
  for (const hash of rejected) it(`rejects ${JSON.stringify(hash)}`, () => assert.equal(returnEntryOf(hash), null));

  it("gives only /play, or /play with a canonical class id in its fragment, for a play entry", () => {
    for (const hash of ["#return=play", `#return=play.${ID}`]) assert.match(returnEntryOf(hash) ?? "", /^\/play(#[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})?$/);
  });
});

describe("the entry a link request carries is the name, never a path", () => {
  it("is play or play.<id>", () => {
    assert.deepEqual(entryBackOf("#return=play"), { path: "/play", field: "play" });
    assert.deepEqual(entryBackOf(`#return=play.${ID}`), { path: `/play#${ID}`, field: `play.${ID}` });
  });
  it("is none for a rejected entry", () => {
    assert.equal(entryBackOf(`#return=play.${ID.toUpperCase()}`), null);
    assert.equal(entryBackOf("#return=/play"), null);
  });
  it("fits the backend's bound of 64 characters", () => {
    assert.ok(`play.${ID}`.length <= 64);
  });
  it("is read from a mailed link's fragment after the token", () => {
    assert.deepEqual(fragmentOf(`#${LINK_TOKEN}&return=play.${ID}`), { kind: "token", token: LINK_TOKEN, back: { path: `/play#${ID}`, field: `play.${ID}` } });
    assert.deepEqual(fragmentOf(`#${LINK_TOKEN}&return=play.${ID.toUpperCase()}`), { kind: "token", token: LINK_TOKEN });
  });
});

describe("the sign-in address of the web player page", () => {
  it("names play, with the class id only when it is a canonical id", () => {
    assert.equal(playSignInAddress(null), "/sign-in#return=play");
    assert.equal(playSignInAddress(ID), `/sign-in#return=play.${ID}`);
    for (const bad of [ID.toUpperCase(), `${ID} `, "", "x", `${ID}#x`, "https://evil.example"]) assert.equal(playSignInAddress(bad), "/sign-in#return=play", bad);
  });
  it("is read back by returnEntryOf, and never has a query", () => {
    for (const id of [null, ID]) {
      const address = playSignInAddress(id);
      assert.ok(!address.includes("?"));
      assert.equal(returnEntryOf(address.slice("/sign-in".length)), id === null ? "/play" : `/play#${id}`);
    }
  });
  it("comes from the page's address: the class it names, or none", () => {
    assert.equal(signInBackAddress(""), "/sign-in#return=play");
    assert.equal(signInBackAddress(`#${ID}`), `/sign-in#return=play.${ID}`);
    assert.equal(signInBackAddress("#nonsense"), "/sign-in#return=play");
    assert.equal(signInBackAddress(`#${ID.toUpperCase()}`), "/sign-in#return=play");
  });
});

describe("the class details page's link target", () => {
  it("is a class only for classes/<canonical id>", () => {
    assert.equal(classIdOfPage(`classes/${ID}`), ID);
    for (const bad of ["classes", "classes/", "classes/x", `classes/${ID.toUpperCase()}`, `classes/${ID}/x`, `devices/${ID}`, `classes/${ID}?x`]) assert.equal(classIdOfPage(bad), null, bad);
  });
});

describe("the fake backend's link request takes the same entries", () => {
  const ask = (v: unknown): ReturnType<typeof linkRequest> => linkRequest("https://site.test", JSON.stringify({ email: "ana@example.com", return_to: v }));
  it("mails the link with play and play.<id>", () => {
    for (const v of ["play", `play.${ID}`]) assert.equal(ask(v).link, `https://site.test/sign-in#${LINK_TOKEN}&return=${v}`);
  });
  it("refuses the entries returnEntryOf refuses", () => {
    for (const v of ["PLAY", "play ", "play.", `play.${ID.toUpperCase()}`, `play.${ID} `, `play.${ID}\n`, `/play`, `play.${ID.slice(1)}`]) assert.equal(ask(v).status, 422, JSON.stringify(v));
  });
});

describe("the web table agrees with the backend's", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "..", "..", "backend", "src", "player_backend", "login_policy.py"), "utf8");
  it("holds the same entries and the same bound", () => {
    assert.match(source, /RETURN_MAX: Final = 64/);
    assert.match(source, /control\(\\\.\s*" \+ _CODE_HALF \+ "-" \+ _CODE_HALF \+ r"\)\?\|play\(\\\." \+ _CLASS_ID \+ "\)\?"/);
    assert.match(source, /_CLASS_ID = "\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}"/);
  });
});

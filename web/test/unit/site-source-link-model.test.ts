// Connect an app's rules (src/site/core/source-link-model.ts, connect-words.ts) and Linked apps'
// (links-model.ts): what the address may ask for, that the page leaves only for the address the
// approval answers with, and what each answer means. Pure: no browser.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Answer } from "../../src/site/core/answer.ts";
import { linkPlateWords } from "../../src/site/core/connect-words.ts";
import { linkCountWords, linksOf } from "../../src/site/core/links-model.ts";
import { afterApprove, afterCheck, approveBody, askOf, backAddressOf, checkBody, SCOPE_WORDS } from "../../src/site/core/source-link-model.ts";
import type { LinkAsk } from "../../src/site/core/source-link-model.ts";
import { impurities } from "../lib/core-purity.ts";

const URI = "https://source.test/player/linked";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const query = (o: Record<string, string>): string => `?${new URLSearchParams(o).toString()}`;
const FULL = { source: "classbeat", redirect_uri: URI, state: "s1", code_challenge: CHALLENGE, code_challenge_method: "S256" };
const without = (o: Record<string, string>, k: string): Record<string, string> => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));
const ASK = askOf(query(FULL)) as LinkAsk;
const ok = (body: unknown): Answer => ({ kind: "ok", status: 200, body });
const refused = (status: number, code: string): Answer => ({ kind: "refused", status, code });
const CHECKED = { source: "classbeat", name: "classbeat", scope: ["publish_classes", "remove_classes", "read_publication_numbers"] };

describe("what the address asks for", () => {
  it("reads the source's four parameters and the method", () => {
    assert.deepEqual(ASK, { source: "classbeat", redirectUri: URI, state: "s1", codeChallenge: CHALLENGE, codeChallengeMethod: "S256" });
    assert.equal(askOf(query(without(FULL, "code_challenge_method")))?.codeChallengeMethod, null);
  });

  it("is not a link when a parameter is missing, empty, given twice or too long", () => {
    for (const k of ["source", "redirect_uri", "state", "code_challenge"] as const) {
      assert.equal(askOf(query(without(FULL, k))), null, `without ${k}`);
      assert.equal(askOf(query({ ...FULL, [k]: "" })), null, `empty ${k}`);
      assert.equal(askOf(`${query(FULL)}&${k}=again`), null, `${k} twice`);
    }
    assert.equal(askOf(`${query(FULL)}&code_challenge_method=plain`), null, "the method twice");
    assert.equal(askOf(query({ ...FULL, source: "s".repeat(41) })), null);
    assert.equal(askOf(query({ ...FULL, redirect_uri: `${URI}/${"x".repeat(2000)}` })), null);
    assert.equal(askOf(query({ ...FULL, state: "s".repeat(501) })), null);
    assert.equal(askOf(""), null);
  });

  it("ignores every other parameter: nothing else in the address is read", () => {
    const extra = `${query(FULL)}&next=https://evil.test/&redirect=https://evil.test/&return_to=//evil.test`;
    assert.deepEqual(askOf(extra), ASK);
  });

  it("sends the check only the source and its address, and the approval the rest", () => {
    assert.deepEqual(checkBody(ASK), { source: "classbeat", redirect_uri: URI });
    assert.deepEqual(approveBody(ASK), { source: "classbeat", redirect_uri: URI, state: "s1", code_challenge: CHALLENGE, code_challenge_method: "S256" });
    assert.equal("code_challenge_method" in approveBody({ ...ASK, codeChallengeMethod: null }), false);
  });
});

describe("the check", () => {
  it("asks with the route's name and scope", () => {
    assert.deepEqual(afterCheck(ASK, ok(CHECKED)), { kind: "ask", name: "classbeat", scope: CHECKED.scope });
    assert.deepEqual(afterCheck(ASK, ok({ ...CHECKED, name: "Studio <b>" })), { kind: "ask", name: "Studio <b>", scope: CHECKED.scope });
  });

  it("is the server fault for an answer it cannot describe: another source, no name, an unknown or empty scope", () => {
    for (const body of [{ ...CHECKED, source: "other" }, { ...CHECKED, name: "" }, { ...CHECKED, name: 3 }, { ...CHECKED, scope: [] }, { ...CHECKED, scope: ["publish_classes", "read_everything"] }, { ...CHECKED, scope: "publish_classes" }, null]) {
      assert.deepEqual(afterCheck(ASK, ok(body)), { kind: "plate", plate: { kind: "server" } }, JSON.stringify(body));
    }
  });

  it("says the link is not valid for an unknown source (400) or a part the backend refuses (422), with no detail", () => {
    assert.deepEqual(afterCheck(ASK, refused(400, "unknown_source")), { kind: "plate", plate: { kind: "not-valid" } });
    assert.deepEqual(afterCheck(ASK, refused(422, "invalid_request")), { kind: "plate", plate: { kind: "not-valid" } });
    assert.deepEqual(linkPlateWords({ kind: "not-valid" }).head, "This link is not valid");
  });

  it("ends the session on a 401, and shows the error plates otherwise", () => {
    assert.deepEqual(afterCheck(ASK, { kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(afterCheck(ASK, { kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(afterCheck(ASK, { kind: "too_many", retryAfter: 60 }), { kind: "plate", plate: { kind: "too-many", retryAfter: 60 } });
    assert.deepEqual(afterCheck(ASK, { kind: "server" }), { kind: "plate", plate: { kind: "server" } });
  });

  it("words every scope the backend names", () => {
    for (const s of CHECKED.scope) assert.ok(SCOPE_WORDS[s]);
  });
});

describe("the address to go back to", () => {
  const back = `${URI}?code=cbp_lc_abc&state=s1`;

  it("is only the address that was asked for, with the approval's query", () => {
    assert.equal(backAddressOf(ASK, back), back);
    const loop = { ...ASK, redirectUri: "http://127.0.0.1:8123/cb" };
    assert.equal(backAddressOf(loop, "http://127.0.0.1:8123/cb?code=c&state=s1"), "http://127.0.0.1:8123/cb?code=c&state=s1");
  });

  it("is never another address, whatever the answer or the address says", () => {
    const bad: unknown[] = [
      "javascript:alert(1)",
      "https://evil.test/?code=c",
      `${URI}evil?code=c`,
      `${URI}.evil.test?code=c`,
      URI,
      `${URI}#?code=c`,
      "/classes",
      "//evil.test/x",
      `${URI}?code=c d`,
      `${URI}?code=c\n`,
      `${URI}?code=é`,
      null,
      42,
      { href: back },
    ];
    for (const r of bad) assert.equal(backAddressOf(ASK, r), null, JSON.stringify(r));
    // An address the source asked for that is not HTTPS, or HTTP away from this computer, is never left for either.
    for (const uri of ["javascript:x", "http://evil.test/cb", "data:text/html,x", "https://u:p@source.test/cb", "ftp://source.test/cb"]) {
      assert.equal(backAddressOf({ ...ASK, redirectUri: uri }, `${uri}?code=c`), null, uri);
    }
  });

  it("is never left for when the address asked for holds a query or a fragment (#422 N1)", () => {
    // The approval's answer would begin with the asked address and "?", so only this rule refuses it.
    for (const uri of [`${URI}#`, `${URI}#frag`, `${URI}?`, `${URI}?x=1`]) {
      assert.equal(backAddressOf({ ...ASK, redirectUri: uri }, `${uri}?code=c&state=s1`), null, uri);
      assert.deepEqual(afterApprove({ ...ASK, redirectUri: uri }, ok({ redirect: `${uri}?code=c&state=s1` })), { kind: "plate", plate: { kind: "server" } }, uri);
    }
  });

  it("is never an address holding a backslash, anywhere in it (#422 N2)", () => {
    // The browser reads `\` as `/`, so `https://a.test\.b.test/cb` has the host a.test here and
    // another host to a parser that does not; an address with one is refused wherever it is.
    for (const uri of ["https://a.test\\.b.test/cb", "https://source.test\\player/linked", "https://source.test/player\\linked"]) {
      assert.equal(backAddressOf({ ...ASK, redirectUri: uri }, `${uri}?code=c&state=s1`), null, uri);
    }
    for (const tail of ["?code=c\\&state=s1", "?code=c&state=s1\\", "?code=c&state=%5C\\"]) assert.equal(backAddressOf(ASK, `${URI}${tail}`), null, tail);
    // The same address without one is still left for.
    assert.equal(backAddressOf(ASK, `${URI}?code=c&state=%5C`), `${URI}?code=c&state=%5C`);
  });

  it("the approval goes back only by that address", () => {
    assert.deepEqual(afterApprove(ASK, ok({ redirect: back })), { kind: "done", to: back });
    assert.deepEqual(afterApprove(ASK, ok({ redirect: "https://evil.test/?code=c" })), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterApprove(ASK, ok({})), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(afterApprove(ASK, ok(null)), { kind: "plate", plate: { kind: "server" } });
  });

  it("the approval's refusals: the limit, the link, the session, the error plates", () => {
    assert.deepEqual(afterApprove(ASK, refused(409, "too_many_links")), { kind: "plate", plate: { kind: "limit" } });
    assert.equal(linkPlateWords({ kind: "limit" }).head, "You have linked 5 apps already");
    assert.deepEqual(afterApprove(ASK, refused(400, "unknown_source")), { kind: "plate", plate: { kind: "not-valid" } });
    assert.deepEqual(afterApprove(ASK, refused(422, "invalid_state")), { kind: "plate", plate: { kind: "not-valid" } });
    assert.deepEqual(afterApprove(ASK, { kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(afterApprove(ASK, { kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(afterApprove(ASK, refused(409, "other")), { kind: "plate", plate: { kind: "server" } });
  });
});

describe("Linked apps", () => {
  const LINK = { id: "9d4e6f51-7e80-4192-bd0e-2f3a4b5c6d7e", source: "classbeat", name: "classbeat", linked_at: "2026-11-02T08:00:00+00:00", last_used_at: null };

  it("reads the list as the backend sends it", () => {
    assert.deepEqual(linksOf({ source_links: [LINK] }), [{ id: LINK.id, name: "classbeat", linkedAt: LINK.linked_at, lastUsedAt: null }]);
    assert.deepEqual(linksOf({ source_links: [] }), []);
    assert.equal(linkCountWords(1), "1 of 5 apps");
  });

  it("refuses a body it does not understand: an id that is not a uuid, no name, a bad date", () => {
    for (const bad of [{ ...LINK, id: "../sessions" }, { ...LINK, id: LINK.id.toUpperCase() }, { ...LINK, name: "" }, { ...LINK, linked_at: "yesterday" }, { ...LINK, last_used_at: 5 }]) {
      assert.equal(linksOf({ source_links: [bad] }), null, JSON.stringify(bad));
    }
    assert.equal(linksOf({}), null);
    assert.equal(linksOf(null), null);
  });
});

describe("purity", () => {
  it("the link modules import no I/O", () => {
    for (const f of ["source-link-model.ts", "connect-words.ts", "links-model.ts"]) {
      const path = fileURLToPath(new URL(`../../src/site/core/${f}`, import.meta.url));
      assert.deepEqual(impurities(path, readFileSync(path, "utf8")), [], f);
    }
  });
});

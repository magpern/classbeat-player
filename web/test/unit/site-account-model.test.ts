// The account pages' shared rules and the Sessions page's (src/site/core/account-model.ts and
// sessions-model.ts; docs/design/site.md, "Account"): what a change's answer means, that a 403
// `recent_sign_in_required` only asks to confirm, and what `GET sessions` holds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Answer } from "../../src/site/core/answer.ts";
import { ACCOUNT_SUBS, accountPlateWords, CONFIRM_WORDS, isRecentRefusal, outcomeOf, plateOf } from "../../src/site/core/account-model.ts";
import { rowAction, SESSION_WORDS, sessionsOf } from "../../src/site/core/sessions-model.ts";
import { impurities } from "../lib/core-purity.ts";

const RECENT: Answer = { kind: "refused", status: 403, code: "recent_sign_in_required" };
const S = { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", browser: "Firefox", created_at: "2026-11-12T08:00:00+00:00", last_used_at: "2026-11-13T09:55:00+00:00", current: true };
const OTHER = { ...S, id: "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e", browser: "Safari", current: false };

describe("the answer to a change", () => {
  it("is done, gone, ended or a plate", () => {
    assert.deepEqual(outcomeOf({ kind: "ok", status: 204, body: null }), { kind: "done", body: null });
    assert.deepEqual(outcomeOf({ kind: "refused", status: 404, code: "not_found" }), { kind: "gone" });
    assert.deepEqual(outcomeOf({ kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(outcomeOf(RECENT), { kind: "plate", plate: { kind: "confirm" } });
    assert.deepEqual(outcomeOf({ kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(outcomeOf({ kind: "server" }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(outcomeOf({ kind: "too_many", retryAfter: 60 }), { kind: "plate", plate: { kind: "too-many", retryAfter: 60 } });
  });

  it("asks to confirm only for a 403 recent_sign_in_required", () => {
    assert.ok(isRecentRefusal(RECENT));
    assert.ok(!isRecentRefusal({ kind: "refused", status: 403, code: "forbidden" }));
    assert.ok(!isRecentRefusal({ kind: "refused", status: 401, code: "recent_sign_in_required" }));
    assert.deepEqual(plateOf({ kind: "refused", status: 403, code: "forbidden" }), { kind: "server" });
  });

  it("words the plates; 'Confirm it is you' as the spec has it", () => {
    assert.equal(accountPlateWords({ kind: "confirm" }).head, "Confirm it is you");
    assert.deepEqual([CONFIRM_WORDS.passkey, CONFIRM_WORDS.link], ["Use a passkey", "Email me a link"]);
    for (const k of ["not-added", "offline", "server"] as const) assert.ok(accountPlateWords({ kind: k }).detail.length > 0, k);
  });

  it("lists the four sub-pages in order", () => {
    assert.deepEqual(
      ACCOUNT_SUBS.map((s) => s[2]),
      ["/account/sessions", "/account/passkeys", "/account/links", "/account/data"],
    );
  });
});

describe("the sessions", () => {
  it("are read in the backend's order", () => {
    const list = sessionsOf({ sessions: [S, OTHER] });
    assert.deepEqual(
      list?.map((s) => [s.browser, s.current, s.startedAt]),
      [
        ["Firefox", true, S.created_at],
        ["Safari", false, OTHER.created_at],
      ],
    );
  });

  it("refuse a body the page does not understand", () => {
    const bad: unknown[] = [null, {}, { sessions: {} }, { sessions: [{ ...S, id: "../passkeys" }] }, { sessions: [{ ...S, current: "yes" }] }, { sessions: [{ ...S, created_at: "yesterday" }] }, { sessions: [S, { ...OTHER, current: true }] }];
    for (const body of bad) assert.equal(sessionsOf(body), null, JSON.stringify(body));
    assert.deepEqual(sessionsOf({ sessions: [] }), []);
  });

  it("give this browser 'Sign out' and every other 'End session'", () => {
    const list = sessionsOf({ sessions: [S, OTHER] });
    assert.ok(list);
    assert.equal(rowAction(list[0]), "Sign out");
    assert.equal(rowAction(list[1]), "End session");
    assert.equal(SESSION_WORDS.thisBrowser, "This browser");
    assert.equal(SESSION_WORDS.endAll, "Sign out everywhere");
  });
});

describe("purity", () => {
  it("the account, sessions, passkeys and WebAuthn creation modules import no I/O", () => {
    for (const f of ["account-model.ts", "sessions-model.ts", "passkeys-model.ts", "webauthn-create.ts"]) {
      const path = fileURLToPath(new URL(`../../src/site/core/${f}`, import.meta.url));
      assert.deepEqual(impurities(path, readFileSync(path, "utf8")), [], f);
    }
  });
});

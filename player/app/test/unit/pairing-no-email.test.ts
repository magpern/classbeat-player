// An instructor with no email (ADR 0010, section 8; backend #499): the pairing answer carries
// `email: null`. The player accepts exactly that, keeps it, shows "your classbeat account" where
// the address would be, and never lets two such accounts share a cache. Every other shape of the
// field is still refused.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { headOf } from "../../src/core/list/states.ts";
import type { PairingState } from "../../src/core/pairing/machine.ts";
import { accountEmail, parsePollAnswer } from "../../src/core/pairing/protocol.ts";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import { parseRecord, recordText } from "../../src/core/pairing/record.ts";
import type { PairingRecord } from "../../src/core/pairing/record.ts";
import { NO_EMAIL, pairingView } from "../../src/core/pairing/view.ts";
import { accountKey } from "../../src/main/sync/link.ts";
import { view } from "./list-fixtures.ts";
import { newToken, ORIGIN } from "./pairing-tokens.ts";

const ok = (body: unknown): HttpAnswer => ({ kind: "http", status: 200, body, retryAfterS: null });

test("poll: `email: null` is an account with no email, and is accepted", () => {
  const token = newToken("dev");
  assert.deepEqual(parsePollAnswer(ok({ device_token: token, email: null })), { kind: "ok", token, email: null });
});

test("poll: every other shape of the email is still refused", () => {
  const token = newToken("dev");
  assert.deepEqual(parsePollAnswer(ok({ device_token: token })), { kind: "unexpected" }, "a missing field");
  for (const email of [undefined, 0, 1, false, true, {}, [], ["a@example.test"], { address: "a@example.test" }]) {
    assert.deepEqual(parsePollAnswer(ok({ device_token: token, email })), { kind: "unexpected" }, `non-string ${JSON.stringify(email)}`);
  }
  for (const email of ["", "   ", "\u0000", "‮", "a".repeat(321)]) {
    assert.deepEqual(parsePollAnswer(ok({ device_token: token, email })), { kind: "unexpected" }, `empty or unshowable ${JSON.stringify(email)}`);
  }
  // A null email never rescues a bad token.
  assert.deepEqual(parsePollAnswer(ok({ device_token: newToken("dc"), email: null })), { kind: "unexpected" });
});

test("record: a null email is kept and read back; a missing or non-string one is refused", () => {
  const r: PairingRecord = { origin: ORIGIN, token: newToken("dev"), email: null };
  assert.deepEqual(parseRecord(recordText(r), false), r);
  const base = { v: 1, origin: ORIGIN, token: r.token };
  for (const bad of [base, { ...base, email: 5 }, { ...base, email: "" }, { ...base, email: [] }]) {
    assert.equal(parseRecord(JSON.stringify(bad), false), null, JSON.stringify(bad));
  }
});

test("shown as \"your classbeat account\" wherever the address would be", () => {
  const record: PairingRecord = { origin: ORIGIN, token: newToken("dev"), email: null };
  const paired = (expired: boolean): PairingState => ({ kind: "paired", attempt: 1, record, deviceName: null, expired });
  assert.deepEqual(pairingView(paired(false), 0), { state: "paired", email: NO_EMAIL, deviceName: null, pairAgain: false });
  const now = pairingView(paired(false), 0);
  const ran = pairingView(paired(true), 0);
  if (now.state !== "paired" || ran.state !== "paired") throw new Error("not paired");
  assert.equal(headOf(view({ pairing: now, sync: { status: "synced" } })).status?.detail, "Paired as your classbeat account");
  assert.equal(headOf(view({ pairing: ran })).plate?.headline, "The pairing with your classbeat account has run out");
});

test("the wording is the backend's own `NO_EMAIL`", () => {
  const policy = readFileSync(new URL("../../../../backend/src/player_backend/account_policy.py", import.meta.url), "utf8");
  assert.match(policy, new RegExp(`^NO_EMAIL: Final = "${NO_EMAIL}"$`, "m"));
});

test("two accounts with no email never share a cache key; an address keeps its key", () => {
  const [a, b] = [newToken("dev"), newToken("dev")];
  assert.notEqual(accountKey(ORIGIN, null, a), accountKey(ORIGIN, null, b), "two pairings, two caches");
  assert.equal(accountKey(ORIGIN, null, a), accountKey(ORIGIN, null, a));
  assert.notEqual(accountKey(ORIGIN, null, a), accountKey("https://other.example.test", null, a));
  // Never the key of an address the player keeps, not even the token's own text or the phrase
  // shown: a kept address has passed `accountEmail`, which leaves no NUL in it.
  const kept = accountEmail(`\u0000${a}`);
  assert.equal(kept, a);
  for (const email of [a, NO_EMAIL, kept]) assert.notEqual(accountKey(ORIGIN, null, a), accountKey(ORIGIN, email ?? "", a), String(email));
  // Unchanged for an address: the key does not depend on the token.
  assert.equal(accountKey(ORIGIN, "ann@example.test", a), accountKey(ORIGIN, "ann@example.test", b));
  assert.match(accountKey(ORIGIN, null, a), /^[0-9a-f]{64}$/);
});

// The Passkeys page's pure rules (src/site/core/passkeys-model.ts; ADR 0002, section 4): the
// limit is the backend's, a refused registration saved nothing, and a 403 only asks to confirm.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Answer } from "../../src/site/core/answer.ts";
import { afterAdd, afterRename, atLimit, countWords, PASSKEY_MAX, passkeysOf } from "../../src/site/core/passkeys-model.ts";

const K = { id: "4d5e6f70-8192-4dae-9f20-3b4c5d6e7f80", name: "Laptop", created_at: "2026-11-03T09:00:00+00:00", last_used_at: null };
const refused = (status: number, code: string): Answer => ({ kind: "refused", status, code });
const register = (answer: Answer): ReturnType<typeof afterAdd> => afterAdd({ step: "register", answer });
const options = (answer: Answer): ReturnType<typeof afterAdd> => afterAdd({ step: "options", answer });

describe("the list and the limit", () => {
  it("has the backend's limit", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../backend/src/player_backend/passkey_policy.py", import.meta.url)), "utf8");
    assert.equal(/^PASSKEYS_MAX: Final = (\d+)$/m.exec(src)?.[1], String(PASSKEY_MAX));
    assert.ok(atLimit(10) && !atLimit(9));
    assert.equal(countWords(3), "3 of 10 passkeys");
  });

  it("reads passkeys, and refuses a body it does not understand", () => {
    assert.deepEqual(passkeysOf({ passkeys: [K] }), [{ id: K.id, name: "Laptop", addedAt: K.created_at, lastUsedAt: null }]);
    const bad: unknown[] = [null, { passkeys: null }, { passkeys: [{ ...K, id: "x" }] }, { passkeys: [{ ...K, last_used_at: 3 }] }, { passkeys: [{ ...K, name: 1 }] }];
    for (const body of bad) assert.equal(passkeysOf(body), null, JSON.stringify(body));
  });
});

describe("after adding", () => {
  it("is added with the passkey the backend sent", () => {
    assert.deepEqual(register({ kind: "ok", status: 201, body: K }), { kind: "added", passkey: { id: K.id, name: "Laptop", addedAt: K.created_at, lastUsedAt: null } });
    assert.deepEqual(register({ kind: "ok", status: 201, body: {} }), { kind: "plate", plate: { kind: "server" } });
  });

  it("is 'Not added' for a cancelled prompt and a refused registration", () => {
    const notAdded = { kind: "plate", plate: { kind: "not-added" } };
    assert.deepEqual(afterAdd("cancelled"), notAdded);
    for (const a of [refused(400, "passkey_refused"), refused(409, "passkey_exists"), refused(422, "invalid_name")]) assert.deepEqual(register(a), notAdded);
  });

  it("asks to confirm on a 403 from either step, and reads the list at the limit", () => {
    const recent = refused(403, "recent_sign_in_required");
    assert.deepEqual(options(recent), { kind: "plate", plate: { kind: "confirm" } });
    assert.deepEqual(register(recent), { kind: "plate", plate: { kind: "confirm" } });
    assert.deepEqual(options(refused(409, "too_many_passkeys")), { kind: "limit" });
    assert.deepEqual(register(refused(409, "too_many_passkeys")), { kind: "limit" });
    assert.deepEqual(options({ kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(options({ kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(options({ kind: "too_many", retryAfter: 30 }), { kind: "plate", plate: { kind: "too-many", retryAfter: 30 } });
  });

  it("reads 403 passkeys_closed from either step as its own plate, never 'Confirm it is you' (ADR 0010, section 7)", () => {
    const closed = refused(403, "passkeys_closed");
    assert.deepEqual(options(closed), { kind: "plate", plate: { kind: "passkeys-closed" } });
    assert.deepEqual(register(closed), { kind: "plate", plate: { kind: "passkeys-closed" } });
  });
});

describe("after renaming", () => {
  it("is renamed, a name error, gone, ended or a plate", () => {
    assert.equal(afterRename({ kind: "ok", status: 200, body: { ...K, name: "New" } }).kind, "renamed");
    assert.deepEqual(afterRename(refused(422, "invalid_name")), { kind: "name-error" });
    assert.deepEqual(afterRename(refused(404, "not_found")), { kind: "gone" });
    assert.deepEqual(afterRename({ kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(afterRename({ kind: "server" }), { kind: "plate", plate: { kind: "server" } });
  });
});

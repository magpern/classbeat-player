// Your data's rules (src/site/core/data-model.ts; docs/design/site.md, "Your data") and how the
// export is handed to the browser (src/site/net/export.ts): what each answer means, the hours from
// `Retry-After`, and that the one link to the file is revoked at once and never put in the page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Answer } from "../../src/site/core/answer.ts";
import { canDelete, DATA_WORDS, deleteOutcomeOf, EXPORT_FILE, exportOutcomeOf, hoursWords } from "../../src/site/core/data-model.ts";
import { exportAccount, saveFile } from "../../src/site/net/export.ts";
import { impurities } from "../lib/core-purity.ts";

const RECENT: Answer = { kind: "refused", status: 403, code: "recent_sign_in_required" };

describe("the export's answer", () => {
  it("is the limit on 429, the session ended on 401, a plate otherwise", () => {
    assert.deepEqual(exportOutcomeOf({ kind: "too_many", retryAfter: 25200 }), { kind: "limit", retryAfter: 25200 });
    assert.deepEqual(exportOutcomeOf({ kind: "not_signed_in" }), { kind: "ended" });
    assert.deepEqual(exportOutcomeOf(RECENT), { kind: "plate", plate: { kind: "confirm" } });
    assert.deepEqual(exportOutcomeOf({ kind: "offline" }), { kind: "plate", plate: { kind: "offline" } });
    assert.deepEqual(exportOutcomeOf({ kind: "ok", status: 200, body: {} }), { kind: "plate", plate: { kind: "server" } });
  });

  it("words the wait in hours, rounded up", () => {
    assert.equal(hoursWords(25200), "in about 7 hours");
    assert.equal(hoursWords(25201), "in about 8 hours");
    assert.equal(hoursWords(1), "in about 1 hour");
    assert.equal(hoursWords(0), "in about 1 hour");
    assert.equal(hoursWords(null), "later");
    assert.equal(DATA_WORDS.limitDetail(25200), "You can export 3 times a day. Try again in about 7 hours.");
  });
});

describe("the deletion's answer", () => {
  it("is deleted only on 204; 422 confirmation_mismatch is the field error", () => {
    assert.deepEqual(deleteOutcomeOf({ kind: "ok", status: 204, body: null }), { kind: "deleted" });
    assert.deepEqual(deleteOutcomeOf({ kind: "ok", status: 200, body: {} }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(deleteOutcomeOf({ kind: "refused", status: 422, code: "confirmation_mismatch" }), { kind: "mismatch" });
    assert.deepEqual(deleteOutcomeOf({ kind: "refused", status: 422, code: "invalid_body" }), { kind: "plate", plate: { kind: "server" } });
    assert.deepEqual(deleteOutcomeOf(RECENT), { kind: "plate", plate: { kind: "confirm" } });
    assert.deepEqual(deleteOutcomeOf({ kind: "not_signed_in" }), { kind: "ended" });
  });

  it("is possible once the field is not empty: the server decides the rest", () => {
    assert.equal(canDelete(""), false);
    assert.equal(canDelete("   "), false);
    assert.equal(canDelete("x"), true);
  });
});

describe("handing the file to the browser", () => {
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const g = globalThis as { document?: unknown; fetch: typeof fetch };
  const realFetch = g.fetch;
  afterEach(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    delete g.document;
    g.fetch = realFetch;
  });

  function stand(): { log: string[]; anchor: Record<string, unknown> } {
    const log: string[] = [];
    const anchor: Record<string, unknown> = { click: () => log.push(`click ${String(anchor.href)} ${String(anchor.download)}`) };
    URL.createObjectURL = () => (log.push("create"), "blob:https://site.test/1");
    URL.revokeObjectURL = (u: string) => void log.push(`revoke ${u}`);
    g.document = { createElement: (tag: string) => (log.push(`element ${tag}`), anchor) };
    return { log, anchor };
  }

  it("clicks a detached link with the file name, then revokes it", () => {
    const { log, anchor } = stand();
    saveFile(new Blob(["{}"]), EXPORT_FILE);
    assert.deepEqual(log, ["create", "element a", `click blob:https://site.test/1 ${EXPORT_FILE}`, "revoke blob:https://site.test/1"]);
    assert.equal(anchor.rel, "noopener");
  });

  it("revokes the link even when the click throws", () => {
    const { log, anchor } = stand();
    anchor.click = () => {
      throw new Error("blocked");
    };
    assert.throws(() => saveFile(new Blob(["{}"]), EXPORT_FILE));
    assert.equal(log.at(-1), "revoke blob:https://site.test/1");
  });

  it("saves only a success; a refusal is read as an answer and nothing is saved", async () => {
    const { log } = stand();
    g.fetch = (() => Promise.resolve(new Response('{"error":"too_many_requests"}', { status: 429, headers: { "Retry-After": "60" } }))) as typeof fetch;
    assert.deepEqual(await exportAccount(), { kind: "too_many", retryAfter: 60 });
    assert.deepEqual(log, []);
    g.fetch = (() => Promise.resolve(new Response('{"a":1}', { status: 200 }))) as typeof fetch;
    assert.equal(await exportAccount(), "saved");
    assert.equal(log.length, 4);
  });
});

describe("purity", () => {
  it("the data model imports no I/O", () => {
    const path = fileURLToPath(new URL("../../src/site/core/data-model.ts", import.meta.url));
    assert.deepEqual(impurities(path, readFileSync(path, "utf8")), []);
  });
});

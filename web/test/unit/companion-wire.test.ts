// Conformance: the page's hand-written checks (src/companion/core) take every valid example of the
// messages a controller is sent and drop every invalid one, and what the page sends is exactly the
// contract's `hello` and `command`. The page cannot use a schema compiler (its CSP has no
// unsafe-eval), so this test is what holds the checks to schema/live/v1.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_NAMES, outcomeOf } from "../../src/companion/core/answer.ts";
import { ACTIONS } from "../../src/companion/core/state-check.ts";
import { ACK_REASONS, ENDED_REASONS, MAX_FRAME_CHARS, commandMessage, helloText, idFromBytes, isControllerToken, parseInbound } from "../../src/companion/core/wire.ts";
import type { CommandParts } from "../../src/companion/core/wire.ts";
import { ID22 } from "../../src/companion/core/shape.ts";
import { SECRET43, examples, schemaEnum } from "../lib/live-examples.ts";

describe("companion wire: what a controller is sent", () => {
  for (const schema of ["companion-state", "ack", "ended", "host-status"]) {
    it(`${schema}: every valid example is taken, every invalid one dropped`, () => {
      for (const ex of examples(schema, "valid")) assert.ok(parseInbound(ex.text), ex.name);
      for (const ex of examples(schema, "invalid")) assert.equal(parseInbound(ex.text), null, ex.name);
    });
  }

  it("welcome: a controller's welcome is taken; a host's, and every invalid one, dropped", () => {
    for (const ex of examples("welcome", "valid")) {
      const role = (ex.value as { role: string }).role;
      assert.equal(parseInbound(ex.text) !== null, role === "controller", ex.name);
    }
    for (const ex of examples("welcome", "invalid")) assert.equal(parseInbound(ex.text), null, ex.name);
  });

  it("messages routed only to the host are never taken", () => {
    for (const schema of ["controller-joined", "controller-left", "control-code", "code-cancelled", "command-forwarded", "command", "hello", "make-code", "drop", "end", "command-result"]) {
      for (const ex of examples(schema, "valid")) assert.equal(parseInbound(ex.text), null, ex.name);
    }
  });

  it("a frame over 64 KiB, or not JSON, is dropped", () => {
    const [ok] = examples("host-status", "valid");
    assert.ok(parseInbound(ok.text));
    assert.equal(parseInbound(ok.text + " ".repeat(MAX_FRAME_CHARS)), null);
    assert.equal(parseInbound("{"), null);
    assert.equal(parseInbound("[]"), null);
  });

  it("the page's lists equal the schema's enums", () => {
    assert.deepEqual([...ACK_REASONS, null], schemaEnum("ack", "properties/reason"));
    assert.deepEqual([...ENDED_REASONS], schemaEnum("ended", "properties/reason"));
    assert.deepEqual([...ACTIONS], schemaEnum("command", "properties/action"));
    assert.deepEqual([...ACTIONS], schemaEnum("companion-state", "properties/allowed/items"));
    assert.deepEqual([...ERROR_NAMES], schemaEnum("error", "properties/error"));
  });
});

describe("companion wire: what the page sends", () => {
  const partsOf = (v: Record<string, unknown>): CommandParts => ({ id: v.id as string, run: v.run as string, basis: v.basis as number, action: v.action as CommandParts["action"], ...(v.deltaMs !== undefined ? { deltaMs: v.deltaMs as 5000 } : {}) });

  it("every valid command example is exactly what the page builds from its parts", () => {
    for (const ex of examples("command", "valid")) assert.deepEqual(commandMessage(partsOf(ex.value as Record<string, unknown>)), ex.value, ex.name);
  });

  it("no invalid command example can come out of the builder", () => {
    for (const ex of examples("command", "invalid")) {
      let built: unknown;
      try {
        built = commandMessage(partsOf(ex.value as Record<string, unknown>));
      } catch {
        built = null;
      }
      assert.notDeepEqual(built, ex.value, ex.name);
    }
  });

  it("a nudge is exactly +5000 or -5000 ms, and only a nudge carries deltaMs", () => {
    const base = { id: "dGFwLTAwMDAwMDAwMDAwMQ", run: "Q2xhc3NSdW4tMDAwMDAwMQ", basis: 1 };
    assert.throws(() => commandMessage({ ...base, action: "nudge" }));
    assert.throws(() => commandMessage({ ...base, action: "nudge", deltaMs: 10_000 as 5000 }));
    assert.deepEqual(Object.keys(commandMessage({ ...base, action: "pause", deltaMs: 5000 })).sort(), ["action", "basis", "id", "run", "type", "v"]);
  });

  it("hello: the controller token only, as the valid example; host and rider tokens are refused", () => {
    for (const ex of examples("hello", "valid")) {
      const token = (ex.value as { token: string }).token;
      if (token.startsWith("cbp_ctl_")) assert.deepEqual(JSON.parse(helloText(token)), ex.value, ex.name);
      else assert.throws(() => helloText(token), ex.name);
    }
    for (const ex of examples("hello", "invalid")) {
      const token = (ex.value as { token?: unknown }).token;
      if (!isControllerToken(token)) continue;
      assert.notDeepEqual(JSON.parse(helloText(token)), ex.value, ex.name);
    }
    assert.ok(isControllerToken(`cbp_ctl_${SECRET43}`));
  });

  it("an id is 16 random bytes as base64url, the contract's 22 characters", () => {
    for (let k = 0; k < 64; k += 1) {
      const bytes = new Uint8Array(16).map((_, i) => (i * 37 + k * 11) & 255);
      assert.match(idFromBytes(bytes), ID22);
    }
    assert.match(idFromBytes(new Uint8Array(16).fill(255)), ID22);
    assert.throws(() => idFromBytes(new Uint8Array(15)));
  });
});

describe("companion wire: the HTTP answers", () => {
  it("controller-answer: the valid example gives the token; every invalid one gives none", () => {
    for (const ex of examples("controller-answer", "valid")) assert.deepEqual(outcomeOf({ kind: "answer", status: 200, body: ex.value }), { kind: "token", token: `cbp_ctl_${SECRET43}` }, ex.name);
    for (const ex of examples("controller-answer", "invalid")) assert.equal(outcomeOf({ kind: "answer", status: 200, body: ex.value }).kind, "unexpected", ex.name);
  });

  it("error: every valid example is that refusal; every invalid one is unexpected", () => {
    for (const ex of examples("error", "valid")) assert.deepEqual(outcomeOf({ kind: "answer", status: 403, body: ex.value }), { kind: "refused", error: (ex.value as { error: string }).error }, ex.name);
    for (const ex of examples("error", "invalid")) assert.equal(outcomeOf({ kind: "answer", status: 403, body: ex.value }).kind, "unexpected", ex.name);
  });

  it("every error name of the contract is read as itself", () => {
    for (const error of ERROR_NAMES) assert.deepEqual(outcomeOf({ kind: "answer", status: 400, body: { error } }), { kind: "refused", error });
  });

  it("429 is too many requests whatever its body; 413 without a body is too large; no answer is unreachable", () => {
    assert.deepEqual(outcomeOf({ kind: "answer", status: 429, body: null }), { kind: "refused", error: "too_many_requests" });
    assert.deepEqual(outcomeOf({ kind: "answer", status: 413, body: null }), { kind: "refused", error: "body_too_large" });
    assert.deepEqual(outcomeOf({ kind: "unreachable" }), { kind: "unreachable" });
    assert.equal(outcomeOf({ kind: "answer", status: 502, body: "<html>" }).kind, "unexpected");
    assert.equal(outcomeOf({ kind: "answer", status: 200, body: { controllerToken: "cbp_hst_" + SECRET43 } }).kind, "unexpected");
  });
});

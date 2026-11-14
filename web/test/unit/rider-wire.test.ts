// What the rider page reads from the live WebSocket, against every recorded example of the contract
// (schema/live/v1/examples): each valid rider message is read, each invalid one dropped, as is any
// message meant for a host or a controller. The page sends one frame only: `hello`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENDED_REASONS, MAX_FRAME_CHARS, POSITIONS, STATUSES, checkRiderState, helloText, isRiderToken, parseInbound } from "../../src/rider/core/wire.ts";
import { SECRET43, examples, schemaEnum } from "../lib/live-examples.ts";

const TOKEN = `cbp_rdr_${SECRET43}`;

describe("the rider's inbound messages", () => {
  it("reads every valid rider_state, welcome-rider, host_status and ended example", () => {
    for (const ex of examples("rider-state", "valid")) {
      assert.deepEqual(parseInbound(ex.text), { type: "rider_state", state: ex.value }, ex.name);
      assert.ok(checkRiderState(ex.value), ex.name);
    }
    for (const ex of examples("welcome-rider", "valid")) assert.equal(parseInbound(ex.text)?.type, "welcome", ex.name);
    for (const ex of examples("host-status", "valid")) assert.equal(parseInbound(ex.text)?.type, "host_status", ex.name);
    for (const ex of examples("ended", "valid")) assert.equal(parseInbound(ex.text)?.type, "ended", ex.name);
  });

  it("drops every invalid example of those four", () => {
    for (const schema of ["rider-state", "welcome-rider", "host-status", "ended"]) {
      for (const ex of examples(schema, "invalid")) assert.equal(parseInbound(ex.text), null, ex.name);
    }
  });

  it("drops a host's or a controller's welcome and every message that is not sent to a rider", () => {
    for (const ex of examples("welcome", "valid")) assert.equal(parseInbound(ex.text), null, ex.name);
    for (const schema of ["companion-state", "command-result", "lock-state", "rider-joined", "rider-left", "join-code", "controller-joined", "error"]) {
      for (const ex of examples(schema, "valid")) assert.equal(parseInbound(ex.text), null, ex.name);
    }
  });

  it("keeps its enums in step with the schemas", () => {
    assert.deepEqual([...ENDED_REASONS].sort(), [...schemaEnum("ended", "properties/reason")].sort() as string[]);
    assert.deepEqual([...STATUSES].sort(), [...schemaEnum("rider-state", "properties/status")].sort() as string[]);
    const positions = schemaEnum("rider-state", "properties/now/properties/position/anyOf/0") as string[];
    assert.deepEqual([...POSITIONS].sort(), positions.sort());
  });

  it("does not read text that is not JSON, of another version, or too long", () => {
    assert.equal(parseInbound("not json"), null);
    assert.equal(parseInbound('{"v":2,"type":"host_status","connected":true}'), null);
    assert.equal(parseInbound(`{"v":1,"type":"host_status","connected":true,"pad":"${"x".repeat(MAX_FRAME_CHARS)}"}`), null);
  });
});

describe("hello", () => {
  it("is the only message, and carries a rider token only", () => {
    assert.deepEqual(JSON.parse(helloText(TOKEN)), { v: 1, type: "hello", token: TOKEN });
    for (const ex of examples("hello", "valid")) {
      const v = ex.value as { token: string };
      if (isRiderToken(v.token)) assert.deepEqual(JSON.parse(helloText(v.token)), ex.value, ex.name);
      else assert.throws(() => helloText(v.token), ex.name);
    }
    assert.throws(() => helloText(`cbp_ctl_${SECRET43}`));
    assert.throws(() => helloText(""));
  });
});

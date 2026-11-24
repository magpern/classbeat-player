// The mix code reads only id, length_ms and offset_ms of music.swedebeat_mix (reviewer note on #695).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classMixOf } from "../../src/core/mix/class-mix.ts";

describe("classMixOf", () => {
  it("reads the three fields", () => {
    assert.deepEqual(classMixOf({ source: "swedebeat", swedebeat_mix: { id: "mix-1", length_ms: 3600000, offset_ms: 5000 } }), { id: "mix-1", lengthMs: 3600000, offsetMs: 5000 });
    assert.deepEqual(classMixOf({ swedebeat_mix: { id: "m", length_ms: 1 } }), { id: "m", lengthMs: 1, offsetMs: 0 });
  });
  it("ignores an extra field such as a url: the result holds only the three", () => {
    const got = classMixOf({ swedebeat_mix: { id: "mix-1", length_ms: 10, offset_ms: 0, url: "http://127.0.0.1/x", token: "t", extra: { a: 1 } } });
    assert.deepEqual(got, { id: "mix-1", lengthMs: 10, offsetMs: 0 });
    assert.deepEqual(Object.keys(got!).sort(), ["id", "lengthMs", "offsetMs"]);
  });
  it("returns null for no mix or a malformed one", () => {
    for (const music of [null, undefined, "x", {}, { swedebeat_mix: null }, { swedebeat_mix: { id: "", length_ms: 1 } }, { swedebeat_mix: { id: "a b", length_ms: 1 } }, { swedebeat_mix: { id: "a", length_ms: 0 } }, { swedebeat_mix: { id: "a", length_ms: 1.5 } }, { swedebeat_mix: { id: "a", length_ms: 1, offset_ms: -1 } }]) {
      assert.equal(classMixOf(music), null, JSON.stringify(music));
    }
  });
});

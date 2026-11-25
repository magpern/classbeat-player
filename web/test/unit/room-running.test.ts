// A running class on the room screen (docs/design/running-class.md, ADR 0015 section 2): the zone as a
// number, a name and a colour, the incline target as text, and no cadence, position or pattern anywhere.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { RUNNING_FIXTURES, runningClass } from "../../src/fixtures/running-class.ts";
import { clockAt, linkAt } from "../../src/fixtures/build.ts";
import type { RoomInput } from "../../src/room/input.ts";

const model = (name: string) => toRoomModel(RUNNING_FIXTURES[name]);

describe("a running class on the room screen", () => {
  it("raised: the zone as number, name and targets; one Target metric, 'Incline raised'; the next is flat", () => {
    const m = model("running-class");
    assert.equal(m.kind, "running");
    assert.deepEqual([m.gel?.look, m.gel?.numeral, m.gel?.name, m.gel?.targets], ["zone", "4", "Threshold", ["RPE 5–6", "81–89% HRmax"]]);
    assert.deepEqual(m.metrics.map((x) => [x.label, x.value, x.unit, x.incline ?? false]), [["Target", "Incline raised", null, true], ["Song", "160", "bpm", false]]);
    assert.deepEqual(m.next, { end: false, zone: 2, name: "Endurance", length: "2:00", cadence: null, position: "Incline flat", cue: "Keep the stride light." });
  });

  it("flat: 'Incline flat'; the next is raised", () => {
    const m = model("running-class-flat");
    assert.deepEqual(m.metrics.map((x) => [x.label, x.value]), [["Target", "Incline flat"], ["Song", "160"]]);
    assert.equal(m.next?.position, "Incline raised");
  });

  it("has no cadence gauge, no seated or standing cue and no pattern, in any interval", () => {
    const doc = runningClass();
    for (const iv of doc.intervals) {
      const view = clockAt(doc, iv.start_ms + 1_000);
      const input: RoomInput = { doc, view, link: linkAt(view, "Locked") };
      const m = toRoomModel(input);
      const words = JSON.stringify([m.metrics.map((x) => [x.label, x.value, x.unit]), m.next?.cadence, m.next?.position]);
      assert.deepEqual(m.metrics.map((x) => x.label), ["Target", "Song"]);
      assert.equal(m.metrics.some((x) => x.pattern !== undefined), false);
      assert.doesNotMatch(words, /Cadence|Position|Seated|Standing|rpm/i);
      assert.equal(m.count, null);
    }
  });

  it("the intro and the finished screen keep the class's own layout", () => {
    const doc = runningClass();
    for (const [classMs, status] of [[0, "ready"], [doc.class.length_ms, "ended"]] as const) {
      const view = clockAt(doc, classMs, status);
      const m = toRoomModel({ doc, view, link: linkAt(view, "Locked") });
      assert.equal(m.metrics.length, 0);
      assert.doesNotMatch(JSON.stringify(m.intro), /Cadence|Seated|Standing/i);
    }
  });

  it("a cycling class is unchanged", () => {
    const doc = { ...runningClass(), class: { ...runningClass().class, sport: "cycling" as const } };
    const view = clockAt(doc, 650_000);
    const m = toRoomModel({ doc, view, link: linkAt(view, "Locked") });
    assert.deepEqual(m.metrics.map((x) => x.label), ["Cadence", "Position", "Song"]);
  });
});

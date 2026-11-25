// A running class's text (running-class.md, "What a running class changes", item 1): one "Target" metric with the
// incline replaces Cadence and Position, with no dash and no empty slot, and the next row ends with the incline.
// The incline is text only: the scene's own inputs stay pinned in running-inputs.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RUNNING_DOC } from "../demo/running-class.ts";
import { deriveClass } from "../join/room-feed-calc.ts";
import { textView } from "../src/text-view-calc.ts";

const made = deriveClass(RUNNING_DOC);
const at = (classMs: number, aspect = 16 / 9) => {
  assert.ok(made !== null);
  return textView({ cls: made.text, classMs, songIndex: 0, songPosMs: classMs, link: { state: "Locked" }, reducedMotion: false, aspect });
};

test("a running class shows one Target metric with the incline, and the next row ends with the incline", () => {
  for (const aspect of [16 / 9, 4 / 3]) {
    const flat = at(5_000, aspect);
    assert.deepEqual(flat.metrics.map((m) => [m.label, m.value]), [["Target", "Incline flat"], ["Song", "120"]]);
    assert.equal(flat.next.spec, "Incline flat");
  }
  const raised = at(25_000);
  assert.deepEqual(raised.metrics.map((m) => [m.label, m.value]), [["Target", "Incline flat"], ["Song", "120"]]);
  const onRaised = at(45_000);
  assert.deepEqual(onRaised.metrics.map((m) => [m.label, m.value]), [["Target", "Incline raised"], ["Song", "120"]]);
  assert.equal(onRaised.next.spec, "Incline raised");
});

test("a running class has no Cadence or Position slot and no dash value, at any moment", () => {
  for (const t of [0, 25_000, 65_000, 85_000, 125_000, 150_000]) {
    const labels = at(t).metrics.map((m) => m.label);
    assert.deepEqual(labels.filter((l) => l === "Cadence" || l === "Position"), [], `slots at ${t}`);
    assert.ok(at(t).metrics.every((m) => m.value !== "–" && m.value !== ""), `dash at ${t}`);
  }
});

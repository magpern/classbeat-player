// The class clock reaching its end ends the pin (main/controller.ts `onEnded`): once per class,
// not before the end, and not again for a class that is opened later and has not ended.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createController } from "../../src/main/controller.ts";
import { converterExamples } from "./fixtures.ts";

test("onEnded fires once when the clock reaches the end of the class, and once per class", () => {
  let t = 0;
  const c = createController(() => t);
  let ended = 0;
  c.onEnded(() => void ended++);
  const [first] = converterExamples();
  const text = readFileSync(first, "utf8");
  const lengthMs = (JSON.parse(text) as { class: { length_ms: number } }).class.length_ms;
  c.open("a.json", text);
  c.command({ type: "start" });
  t += 1000;
  c.snapshot();
  assert.equal(ended, 0, "not before the end");
  t += lengthMs + 1000;
  assert.equal(c.snapshot().view?.status, "ended");
  c.snapshot();
  assert.equal(ended, 1, "once");
  // A new class that has not ended does not fire; its own end does.
  c.open("b.json", text);
  c.command({ type: "start" });
  t += 1000;
  c.snapshot();
  assert.equal(ended, 1);
  t += lengthMs;
  c.snapshot();
  assert.equal(ended, 2);
});

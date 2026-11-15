// dom-kit.ts is the only file that sets a style, and it takes numbers only: each function throws on a
// non-number, NaN and Infinity, and builds its value from fixed words. A fake element stands in for the node.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setFontSize, setLeft, setStrip, setWidth } from "../layer/dom-kit.ts";

const fake = (): { style: Record<string, string> } => ({ style: {} });
const as = (e: ReturnType<typeof fake>) => e as unknown as HTMLElement;
const BAD: [string, number][] = [["NaN", NaN], ["Infinity", Infinity], ["-Infinity", -Infinity], ["a string", "1" as unknown as number], ["undefined", undefined as unknown as number], ["an object", {} as unknown as number]];

test("each style function builds its value from numbers", () => {
  const e = fake();
  setLeft(as(e), 12.3456, 3);
  setWidth(as(e), 5, 2);
  setFontSize(as(e), 4.6, 1);
  assert.deepEqual(Object.assign({}, e.style), { left: "12.346vw", width: "5.00vw", fontSize: "4.6vh" });
  setStrip(as(e), 4.5, -1.25, [{ from: 0, to: 0.5, up: true }, { from: 0.5, to: 1, up: false }]);
  assert.equal(e.style.backgroundImage, "linear-gradient(90deg, var(--ink) 0.00% 50.00%, transparent 50.00% 100.00%)");
  assert.deepEqual([e.style.backgroundSize, e.style.backgroundPosition], ["4.500vw 100%", "-1.250vw 0"]);
});

for (const [what, bad] of BAD) {
  test(`every style function throws on ${what}`, () => {
    const e = as(fake());
    assert.throws(() => setLeft(e, bad, 3), RangeError);
    assert.throws(() => setWidth(e, bad, 3), RangeError);
    assert.throws(() => setFontSize(e, bad, 1), RangeError);
    assert.throws(() => setLeft(e, 1, bad), RangeError, "the digits too");
    assert.throws(() => setStrip(e, bad, 0, []), RangeError);
    assert.throws(() => setStrip(e, 1, bad, []), RangeError);
    assert.throws(() => setStrip(e, 1, 0, [{ from: bad, to: 1, up: true }]), RangeError);
    assert.throws(() => setStrip(e, 1, 0, [{ from: 0, to: bad, up: true }]), RangeError);
  });
}

test("the digits are an integer from 0 to 6, and a failed call writes nothing", () => {
  for (const digits of [-1, 7, 1.5]) assert.throws(() => setLeft(as(fake()), 1, digits), RangeError);
  const e = fake();
  assert.throws(() => setStrip(as(e), 1, 0, [{ from: 0, to: NaN, up: true }]), RangeError);
  assert.deepEqual(e.style, {}, "the throw comes before any style is set");
});

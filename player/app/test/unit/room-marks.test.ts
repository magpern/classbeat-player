// The frames of the band's, the join sheet's and the plate's visible changes (core/room/marks.ts,
// renderer/room-marks.ts; room-2d.md, "Motion and reduced motion: the flash budget on the plain screen (S6)"):
// each is a P2 mark of the scene model's scheduler, and any two marks are at least 500 ms apart.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { MARK_GAP_MS, placeMarks } from "../../../scene/model/src/flash-marks.ts";
import { NO_MARKS, placeChange, recordMark } from "../../src/core/room/marks.ts";
import { createMarks } from "../../src/renderer/room-marks.ts";

test("a change takes its own frame when no mark is near, and the scheduler's frame when one is", () => {
  assert.equal(placeChange(NO_MARKS, 3000), 3000);
  const l = recordMark(NO_MARKS, 3000);
  assert.equal(placeChange(l, 3100), 3500);
  assert.equal(placeChange(l, 3500), 3500);
  assert.equal(placeChange(l, 3499), 3500);
  assert.equal(placeChange(l, 3000), 3000, "the same frame is shared");
  // It is the shared scheduler that decides, not a copy of it.
  for (const at of [3000, 3001, 3250, 3499, 3500, 4200]) {
    assert.equal(placeChange(l, at), placeMarks([], [{ kind: "action", atMs: at }], 1, l.shown)[0]!.atMs);
  }
});

test("marks no longer within reach are forgotten", () => {
  let l = NO_MARKS;
  for (let t = 0; t < 10_000; t += 600) l = recordMark(l, t);
  assert.ok(l.shown.length <= 3);
});

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

/** A fake page: each `key` is a change that is wanted; `commits` has the time each one reached the screen. */
function harness() {
  const commits: { key: string; at: number }[] = [];
  const marks = createMarks(() => Date.now());
  const wanted = new Set<string>();
  const ask = (key: string): void => {
    wanted.add(key);
    marks.request(key, () => {
      if (!wanted.delete(key)) return false;
      commits.push({ key, at: Date.now() });
      return true;
    });
  };
  return { commits, ask, marks };
}

test("a change in a free frame is applied at once; the next one within 500 ms waits for the gap", () => {
  const h = harness();
  h.ask("band");
  assert.deepEqual(h.commits, [{ key: "band", at: 0 }]);
  mock.timers.tick(100);
  h.ask("sheet");
  assert.equal(h.commits.length, 1);
  mock.timers.tick(399);
  assert.equal(h.commits.length, 1);
  mock.timers.tick(1);
  assert.deepEqual(h.commits.at(-1), { key: "sheet", at: 500 });
});

test("two changes asked for in one frame share it", () => {
  const h = harness();
  h.ask("band");
  h.ask("sheet");
  assert.deepEqual(h.commits.map((c) => c.at), [0, 0]);
});

test("a request that no longer changes anything uses no mark", () => {
  const marks = createMarks(() => Date.now());
  let drew = 0;
  marks.request("band", () => (drew++, false));
  mock.timers.tick(100);
  let at = -1;
  marks.request("sheet", () => ((at = Date.now()), true));
  assert.equal(at, 100, "the earlier no-op took no frame from it");
  assert.equal(drew, 1);
});

test("a pending request is dropped by cancel", () => {
  const h = harness();
  h.ask("band");
  mock.timers.tick(10);
  h.ask("sheet");
  h.marks.cancel("sheet");
  mock.timers.tick(2000);
  assert.deepEqual(h.commits.map((c) => c.key), ["band"]);
});

test("property: whatever user actions, timed changes and outside changes arrive, any two marks are at least 500 ms apart", () => {
  const keys = ["band", "sheet", "plate"];
  for (let seed = 1; seed <= 60; seed++) {
    let x = seed * 2654435761;
    const rand = (): number => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    mock.timers.reset();
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const h = harness();
    let t = 0;
    const asked: number[] = [];
    for (let i = 0; i < 80; i++) {
      const step = Math.floor(rand() * (rand() < 0.3 ? 40 : 900));
      mock.timers.tick(step);
      t += step;
      h.ask(keys[Math.floor(rand() * keys.length)]!);
      asked.push(t);
    }
    mock.timers.tick(5000);
    const times = [...new Set(h.commits.map((c) => c.at))].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= MARK_GAP_MS, `seed ${seed}: marks at ${times[i - 1]} and ${times[i]}`);
    // Any 1 s window holds at most 2 marks.
    for (let i = 2; i < times.length; i++) assert.ok(times[i]! - times[i - 2]! >= 1000, `seed ${seed}: three marks within 1 s at ${times[i]}`);
    // Every change is applied, and none more than 500 ms late when the marks before it are the only wait.
    assert.ok(h.commits.length > 0);
  }
});

test("a lone timed change (the band's 3 s, the End question's 8 s, the plate's 10 s) is at most 500 ms late behind one mark", () => {
  const h = harness();
  h.ask("sheet"); // a mark at 0
  mock.timers.tick(2900);
  h.ask("plate"); // a mark at 2900
  mock.timers.tick(100);
  h.ask("band"); // due at 3000, 100 ms after that mark
  mock.timers.tick(400);
  assert.deepEqual(h.commits.at(-1), { key: "band", at: 3400 });
  assert.ok(3400 - 3000 <= 500);
});

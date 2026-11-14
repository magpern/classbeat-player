// rider_state builder (issue #361, ADR 0007 section 2): from the clock snapshot and the class only,
// matching the contract, rounded to whole numbers, nothing of any rider. Pure; fakes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import { snapshotOf } from "../../src/core/player-state.ts";
import { MAX_RIDER_NEXT, riderStateOf } from "../../src/core/live/rider-state.ts";
import type { RiderInput } from "../../src/core/live/rider-state.ts";
import { following, liveSchema, loaded, NOW, RUN, text } from "./live-rig.ts";

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(liveSchema("rider-state"));
const valid = (v: unknown): void => assert.ok(validate(v), JSON.stringify(validate.errors));
const doc = JSON.parse(text) as Class;

function inputOf(s: ReturnType<typeof loaded>): RiderInput {
  const { doc: d, view, link } = snapshotOf(s, NOW, false);
  assert.ok(d && view && link);
  return { doc: d, view, link };
}

// A type test: the builder's parameters are the class input, the run and the counter, and the
// input has exactly the class, the clock view and the hold. A rider field would not compile.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const paramsAreNoRiderInput: Exact<Parameters<typeof riderStateOf>, [RiderInput, string, number]> = true;
const inputKeys: Exact<keyof RiderInput, "doc" | "view" | "link"> = true;

test("the builder takes the class input, a run and a counter, and no rider input", () => {
  assert.ok(paramsAreNoRiderInput && inputKeys);
  assert.equal(riderStateOf.length, 3);
});

test("the content: run, own seq, status, times, the interval now and the next three, with zones", () => {
  const st = riderStateOf(inputOf(loaded({ mode: "manual", state: "Manual" }, "running", 60_000)), RUN, 5);
  valid(st);
  const i = doc.intervals.findLastIndex((iv) => iv.start_ms <= 60_000);
  const iv = doc.intervals[i];
  assert.equal(st.run, RUN);
  assert.equal(st.seq, 5);
  assert.equal(st.status, "running");
  assert.equal(st.classMs, 60_000);
  assert.equal(st.now.index, i);
  assert.equal(st.now.zone.number, iv.zone);
  assert.equal(st.now.zone.name, doc.zone_scale.find((z) => z.zone === iv.zone)?.name);
  assert.equal(st.now.position, iv.position ?? null);
  assert.equal(st.now.remainingMs, iv.start_ms + iv.length_ms - 60_000);
  assert.equal(st.next.length, MAX_RIDER_NEXT);
  assert.deepEqual(
    st.next.map((n) => [n.startMs, n.lengthMs, n.zone.number, n.position]),
    doc.intervals.slice(i + 1, i + 4).map((n) => [n.start_ms, n.length_ms, n.zone, n.position ?? null]),
  );
});

test("status: not started, paused, ended, and holding at a window's end", () => {
  const status = (s: ReturnType<typeof loaded>): string => riderStateOf(inputOf(s), RUN, 0).status;
  assert.equal(status(loaded({}, "ready")), "not_started");
  assert.equal(status(loaded({}, "paused")), "paused");
  assert.equal(status(loaded({}, "ended")), "ended");
  const held = riderStateOf(inputOf(loaded(following("Locked", { held: true, holdUntil: NOW + 4000 }), "paused")), RUN, 0);
  assert.equal(held.status, "holding");
  assert.equal(held.now.remainingMs, 4000);
});

test("no next interval at the last one", () => {
  const st = riderStateOf(inputOf(loaded({}, "running", doc.intervals.at(-1)?.start_ms ?? 0)), RUN, 0);
  valid(st);
  assert.deepEqual(st.next, []);
});

test("a test interval carries its kind and minutes, others null", () => {
  const base = inputOf(loaded({}, "running", 60_000));
  const iv = { ...base.doc.intervals[base.view.intervalIndex], test: { kind: "ftp" as const, minutes: 20 as const }, position: "standing" as const };
  const intervals = base.doc.intervals.map((x, k) => (k === base.view.intervalIndex ? iv : x)) as Class["intervals"];
  const st = riderStateOf({ ...base, doc: { ...base.doc, intervals } }, RUN, 0);
  valid(st);
  assert.deepEqual(st.now.test, { kind: "ftp", minutes: 20 });
  assert.equal(st.now.position, "standing");
  const none = riderStateOf({ ...base, doc: { ...base.doc, intervals: base.doc.intervals.map((x) => ({ ...x, test: undefined, position: undefined })) as Class["intervals"] } }, RUN, 0);
  assert.equal(none.now.test, null);
  assert.equal(none.now.position, null);
});

const ROUNDING: readonly (readonly [string, [number, number] | undefined, [number, number] | null])[] = [
  ["whole numbers stay", [55, 75], [55, 75]],
  ["fractions round to the nearest whole number", [55.4, 75.6], [55, 76]],
  ["half rounds up", [0.5, 1.5], [1, 2]],
  ["missing is null", undefined, null],
];

for (const [name, given, want] of ROUNDING) {
  test(`rounding: ${name}`, () => {
    const base = inputOf(loaded({}, "running", 60_000));
    const z = base.doc.intervals[base.view.intervalIndex].zone;
    const zone_scale = base.doc.zone_scale.map((d) => (d.zone === z ? { ...d, ftp_pct: given, hrmax_pct: given, rpe: given } : d)) as Class["zone_scale"];
    const st = riderStateOf({ ...base, doc: { ...base.doc, zone_scale } }, RUN, 0);
    valid(st);
    assert.deepEqual(st.now.zone.effort, { ftpPct: want, hrmaxPct: want, rpe: want });
  });
}

test("never a nickname, a rider id, a cue, a song or a link state, and always valid, over every state", () => {
  const FORBIDDEN = /nickname|rider|cue|song|artist|title|link|token|code|device|account/i;
  const keys = (v: unknown): string[] => (v !== null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
  for (const status of ["ready", "running", "paused", "ended"] as const) {
    for (const classMs of [0, 60_000, 400_000, 1_000_000_000]) {
      const st = riderStateOf(inputOf(loaded({}, status, classMs)), RUN, 1);
      valid(st);
      assert.deepEqual(
        keys(st).filter((k) => FORBIDDEN.test(k)),
        [],
        "no key names a rider, a cue, a song or a link",
      );
      const json = JSON.stringify(st);
      const zoneNames = doc.zone_scale.map((z) => z.name);
      for (const iv of doc.intervals) if (iv.cue.length > 3 && !zoneNames.some((n) => iv.cue.includes(n))) assert.ok(!json.includes(iv.cue), `the cue never crosses: ${iv.cue}`);
      for (const song of doc.songs) assert.ok(!json.includes(song.title), "the song never crosses");
    }
  }
});

test("pure: the same input gives the same message, and the input is not changed", () => {
  const input = inputOf(loaded({}, "running", 60_000));
  const before = JSON.stringify(input);
  assert.deepEqual(riderStateOf(input, RUN, 3), riderStateOf(input, RUN, 3));
  assert.equal(JSON.stringify(input), before);
});

// Rule guards for the companion's command intake (issue #172; ADR 0005 sections 4, 5 and 7; rule 2).
// - No phone command hands the following of the music over to the manual clock, except
//   undo_resync: a table over every link state, mode, first lock, reader, clock status, undo,
//   canSend true and false, and every action.
// - `allowed` never lists an action whose route is a handover, and never nudge while following.
// - A refused command leaves the clock and the link exactly as they were.
// - The phone's actions are exactly the contract's, they map only to the clock and the music
//   app's play, pause and next, and no equipment word is in the live modules' code.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ClockCommand } from "../../src/core/commands.ts";
import type { Status } from "../../src/core/clock/clock.ts";
import type { LinkModel, LinkStateName } from "../../src/core/link/types.ts";
import { command, routeFor } from "../../src/core/player-state.ts";
import type { PlayerState } from "../../src/core/player-state.ts";
import { COMPANION_ACTIONS, toClockCommand } from "../../src/core/live/actions.ts";
import type { CompanionAction } from "../../src/core/live/actions.ts";
import { allowedActions } from "../../src/core/live/allowed.ts";
import { companionStateOf } from "../../src/core/live/companion-state.ts";
import { intake } from "../../src/core/live/intake.ts";
import { REPO } from "./fixtures.ts";
import { CLOCK_STATUSES, forwarded, id, LINK_STATES, liveSchema, loaded, NOW, published, RUN, undoable, validCompanionState } from "./live-rig.ts";

interface Case {
  readonly name: string;
  readonly s: PlayerState;
  readonly canSend: boolean;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const state of LINK_STATES)
    for (const mode of ["following", "manual"] as const)
      for (const everLocked of [true, false])
        for (const reader of [true, false])
          for (const status of CLOCK_STATUSES as readonly Status[])
            for (const undo of ["none", "open", "closing"] as const)
              for (const playing of [true, false])
                for (const held of [false, true])
                  for (const canSend of [true, false]) {
                    const base: Partial<LinkModel> = { mode, state: state as LinkStateName, everLocked, playing, held, holdUntil: held ? NOW + 4000 : null };
                    const link = undo === "none" ? base : undoable({ ...base, undo: { clockMs: 90_000, at: NOW, until: NOW + (undo === "open" ? 30_000 : 1000) } });
                    const s = loaded(link, status, 60_000, reader);
                    out.push({ name: `${state}/${mode}/locked:${everLocked}/reader:${reader}/${status}/undo:${undo}/playing:${playing}/held:${held}/canSend:${canSend}`, s, canSend });
                  }
  return out;
}

const CASES = cases();
const TAPS: readonly [CompanionAction, number | undefined][] = [
  ["start", undefined],
  ["pause", undefined],
  ["resume", undefined],
  ["skip", undefined],
  ["nudge", 5000],
  ["nudge", -5000],
  ["undo_resync", undefined],
];
/** At the state's own moment, and 2 s later: still fresh, but a closing undo window has closed. */
const TAP_TIMES = [NOW, NOW + 2000];
const modeOf = (s: PlayerState) => s.loaded?.link.mode;

test(`the table covers every link state, canSend true and false and every action (${CASES.length} states x ${TAPS.length} taps)`, () => {
  assert.equal(CASES.length, 6 * 2 * 2 * 2 * 4 * 3 * 2 * 2 * 2);
});

test("allowed never lists an action whose route is a handover, nor nudge while following, nor undo without one", () => {
  for (const c of CASES) {
    const allowed = allowedActions(c.s, NOW, c.canSend);
    for (const a of allowed) {
      if (a === "undo_resync") continue;
      for (const d of a === "nudge" ? [5000, -5000] : [undefined]) {
        assert.notEqual(routeFor(c.s, toClockCommand(a, d) as ClockCommand, c.canSend)?.kind, "manual", `${c.name}: ${a}`);
      }
    }
    if (modeOf(c.s) === "following") assert.ok(!allowed.includes("nudge"), c.name);
    const u = c.s.loaded?.link.undo;
    if (!(u && NOW <= u.until)) assert.ok(!allowed.includes("undo_resync"), c.name);
  }
});

test("every companion_state of the table matches the contract (its own rule: no nudge while following)", () => {
  for (const c of CASES) {
    const st = companionStateOf(c.s, NOW, c.canSend, RUN, 0);
    assert.ok(st !== null && validCompanionState(st), `${c.name}: ${JSON.stringify(validCompanionState.errors)}`);
  }
});

/** A tap at `t` (no later than 3 s after the state it was made on) through the intake. */
function tapAll(c: Case, allowed: readonly CompanionAction[], t: number, applied: Set<string>, from = "everything published"): void {
  const m = published(c.s, c.canSend, 0, NOW, allowed);
  for (const [action, deltaMs] of TAPS) {
    const before = structuredClone(c.s);
    const out = intake(m, c.s, forwarded(action, deltaMs === undefined ? {} : { deltaMs }), t, c.canSend);
    const at = `${c.name} at +${t - NOW} ms (${from}): ${action}`;
    assert.deepEqual(c.s, before, "the intake changes nothing itself");
    assert.ok(out.result !== null, `${at} answered`);
    if (out.result.result !== "applied") {
      assert.equal(out.command, null, `${at} refused, nothing to apply`);
      continue;
    }
    assert.ok(out.command !== null);
    applied.add(out.command.type);
    // Applied means it is offered and does something on the state the tap meets, not the picture.
    assert.ok(allowedActions(c.s, t, c.canSend).includes(action), `${at} applied though not allowed now`);
    const after = command(c.s, out.command, t, c.canSend);
    if (modeOf(c.s) === "following") {
      assert.notEqual(action, "nudge", `${at}: a nudge while following`);
      if (action !== "undo_resync") assert.equal(modeOf(after), "following", `${at} stopped following`);
    }
    if (action === "undo_resync") {
      const u = c.s.loaded?.link.undo;
      assert.ok(u && t <= u.until, `${at}: an undo applied with nothing to undo`);
      assert.equal(modeOf(after), "manual", `${at}: the undo returns to the manual clock`);
    }
  }
}

// Every action published, whatever the state at the tap: this is any picture the phone can have
// shown, tapped on a changed state (publishing more can only let more through check 5).
test("no phone command except undo_resync stops following, and none is applied that the state at the tap does not allow", () => {
  const applied = new Set<string>();
  for (const c of CASES) for (const t of TAP_TIMES) tapAll(c, COMPANION_ACTIONS, t, applied);
  assert.deepEqual([...applied].sort(), ["jump", "next", "pause", "resume", "start", "undo"]);
});

test("published on one real state, tapped on another: manual or following, with or without an undo", () => {
  const applied = new Set<string>();
  const pictures: readonly [string, PlayerState, boolean][] = [
    ["manual, running", loaded({ mode: "manual", state: "Manual" }, "running"), true],
    ["manual, ready", loaded({ mode: "manual", state: "Manual" }, "ready"), false],
    ["locked, an undo", loaded(undoable(), "running"), true],
    ["paused music", loaded({ mode: "following", state: "Paused", everLocked: true }, "paused"), true],
  ];
  for (const [from, a, canSend] of pictures) {
    const allowed = allowedActions(a, NOW, canSend);
    for (const c of CASES) tapAll(c, allowed, NOW + 2000, applied, from);
  }
  assert.ok(applied.size >= 5);
});

test("the one exception: undo_resync, while it can be undone, returns to the manual clock", () => {
  const s = loaded(undoable(), "running");
  assert.ok(allowedActions(s, NOW, true).includes("undo_resync"));
  const out = intake(published(s, true), s, forwarded("undo_resync"), NOW, true);
  assert.deepEqual(out.command, { type: "undo" });
  assert.equal(modeOf(command(s, { type: "undo" }, NOW, true)), "manual");
});

test("everything in allowed, tapped at once on that state, is applied", () => {
  for (const c of CASES) {
    const allowed = allowedActions(c.s, NOW, c.canSend);
    const m = published(c.s, c.canSend);
    allowed.forEach((a, i) => {
      const out = intake(m, c.s, forwarded(a, { id: id(i) }), NOW, c.canSend);
      assert.equal(out.result?.result, "applied", `${c.name}: ${a} ${out.result?.reason}`);
    });
  }
});

test("the phone's actions are exactly the contract's, in every live schema that names them", () => {
  type Node = { readonly properties: Record<string, { readonly enum?: unknown; readonly items?: { readonly enum: unknown } }> };
  const enumOf = (name: string, pick: (s: Node) => unknown) => pick(liveSchema(name) as unknown as Node);
  assert.deepEqual(COMPANION_ACTIONS, ["start", "pause", "resume", "skip", "nudge", "undo_resync"]);
  assert.deepEqual(enumOf("command", (s) => s.properties.action.enum), COMPANION_ACTIONS);
  assert.deepEqual(enumOf("command-forwarded", (s) => s.properties.action.enum), COMPANION_ACTIONS);
  assert.deepEqual(enumOf("companion-state", (s) => s.properties.allowed.items?.enum), COMPANION_ACTIONS);
});

const LIVE_SRC = join(REPO, "player", "app", "src", "core", "live");
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const words = (t: string): string[] =>
  t
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
const EQUIPMENT = readFileSync(join(REPO, "schema", "live", "guard", "equipment-words.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));
const liveFiles = readdirSync(LIVE_SRC).filter((n) => n.endsWith(".ts"));

test("no equipment word (schema/live/guard/equipment-words.txt) as a whole word in the live modules' code", () => {
  assert.ok(EQUIPMENT.includes("resistance") && EQUIPMENT.length >= 10);
  assert.ok(liveFiles.length >= 5);
  for (const n of liveFiles) {
    const hits = words(code(readFileSync(join(LIVE_SRC, n), "utf8"))).filter((w) => EQUIPMENT.includes(w));
    assert.deepEqual(hits, [], n);
  }
});

test("the equipment guard catches what it looks for", () => {
  assert.deepEqual(words(code("const setResistanceLevel = 1; // incline")).filter((w) => EQUIPMENT.includes(w)), ["resistance", "level"]);
  assert.deepEqual(words("target_watts").filter((w) => EQUIPMENT.includes(w)), ["target", "watts"]);
});

test("the live modules reach nothing but the core and the contract's types", () => {
  for (const n of liveFiles) {
    const imports = [...code(readFileSync(join(LIVE_SRC, n), "utf8")).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const p of imports) assert.ok(/^\.\/[a-z-]+\.ts$/.test(p) || /^\.\.\/(?!\.\.)[a-z/-]+\.ts$/.test(p) || /schema\/generated\/ts\/(class|live-[a-z-]+)\.d\.ts$/.test(p), `${n}: ${p}`);
    assert.doesNotMatch(code(readFileSync(join(LIVE_SRC, n), "utf8")), /\bMusicTransport\b|\.send\(/, n);
  }
});

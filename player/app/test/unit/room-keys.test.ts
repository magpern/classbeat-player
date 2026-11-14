// The room window's keys (core/room/keys.ts; room-2d.md, "Keyboard"), with a presentation
// clicker's keys: Page Up and Page Down step, F5 and Shift+F5 are Start only, B and "." do nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction, waitsForQuestion } from "../../src/core/room/keys.ts";
import type { KeyPress } from "../../src/core/room/keys.ts";

const k = (key: string, over: Partial<KeyPress> = {}): KeyPress => ({ key, shift: false, mod: false, alt: false, repeat: false, ...over });

test("each key's command", () => {
  const table: [KeyPress, unknown][] = [
    [k(" "), { kind: "main" }],
    [k("ArrowRight"), { kind: "next" }],
    [k("PageDown"), { kind: "next" }],
    [k("ArrowLeft"), { kind: "previous" }],
    [k("PageUp"), { kind: "previous" }],
    [k("ArrowRight", { shift: true }), { kind: "jump", deltaMs: 5000 }],
    [k("ArrowLeft", { shift: true }), { kind: "jump", deltaMs: -5000 }],
    [k("z", { mod: true }), { kind: "undo" }],
    [k("Z", { mod: true }), { kind: "undo" }],
    [k("f"), { kind: "follow" }],
    [k("F", { shift: true }), { kind: "follow" }],
    [k("End"), { kind: "end" }],
    [k("j"), { kind: "join" }],
    [k("J", { shift: true }), { kind: "join" }],
    [k("Escape"), { kind: "escape" }],
    [k("Tab"), { kind: "tab", back: false }],
    [k("Tab", { shift: true }), { kind: "tab", back: true }],
  ];
  for (const [press, action] of table) assert.deepEqual(keyAction(press), action, JSON.stringify(press));
});

test("a clicker's start-the-show key is Start only; its black-screen keys do nothing", () => {
  assert.deepEqual(keyAction(k("F5")), { kind: "start-only" });
  assert.deepEqual(keyAction(k("F5", { shift: true })), { kind: "start-only" });
  for (const key of ["b", "B", "."]) assert.deepEqual(keyAction(k(key)), { kind: "ignore" }, key);
});

test("a held key repeats nothing", () => {
  for (const key of [" ", "ArrowRight", "ArrowLeft", "PageDown", "PageUp", "f", "F5", "End", "j"]) assert.deepEqual(keyAction(k(key, { repeat: true })), { kind: "ignore" }, key);
  assert.deepEqual(keyAction(k("z", { mod: true, repeat: true })), { kind: "ignore" });
});

test("other keys and chords are left alone", () => {
  for (const press of [k("Enter"), k("a"), k("z"), k("F4"), k("z", { mod: true, shift: true }), k("f", { mod: true }), k("ArrowRight", { alt: true }), k("Tab", { mod: true })]) {
    assert.equal(keyAction(press), null, JSON.stringify(press));
  }
});

test("Space, the arrows, the Page keys, F5, Shift+F5 and J wait while the End question is open; the rest do not", () => {
  const waits = [k(" "), k("ArrowRight"), k("ArrowLeft"), k("PageDown"), k("PageUp"), k("ArrowRight", { shift: true }), k("ArrowLeft", { shift: true }), k("F5"), k("F5", { shift: true }), k("j"), k("J", { shift: true })];
  const acts = [k("z", { mod: true }), k("f"), k("End"), k("Escape"), k("Tab"), k("b")];
  for (const p of waits) assert.equal(waitsForQuestion(keyAction(p)!), true, p.key);
  for (const p of acts) assert.equal(waitsForQuestion(keyAction(p)!), false, p.key);
});

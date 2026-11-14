// The page's keys, its control band and when the band shows (docs/design/play.md, "Controls and keys").
// Pure: a key press in, what it means out; a band state and a time in, the next state out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as M from "../../src/play/band-model.ts";
import { bandView } from "../../src/play/band-view.ts";
import { cancelsBrowser, keyAction, waitsForQuestion } from "../../src/play/keys.ts";
import type { KeyAction, KeyPress } from "../../src/play/keys.ts";

const key = (k: string, o: Partial<KeyPress> = {}): KeyPress => ({ key: k, shift: false, mod: false, alt: false, repeat: false, ...o });
const kind = (k: string, o: Partial<KeyPress> = {}): string | null => keyAction(key(k, o))?.kind ?? null;

describe("the keys", () => {
  it("is the room screen's table minus the keys that have no meaning here", () => {
    assert.equal(kind(" "), "main");
    assert.equal(kind("ArrowRight"), "next");
    assert.equal(kind("PageDown"), "next");
    assert.equal(kind("ArrowLeft"), "previous");
    assert.equal(kind("PageUp"), "previous");
    assert.deepEqual(keyAction(key("ArrowRight", { shift: true })), { kind: "jump", delta: "forward" });
    assert.deepEqual(keyAction(key("ArrowLeft", { shift: true })), { kind: "jump", delta: "back" });
    assert.equal(kind("End"), "end");
    assert.equal(kind("F5"), "start-only");
    assert.equal(kind("F5", { shift: true }), "start-only");
    assert.deepEqual(keyAction(key("Tab", { shift: true })), { kind: "tab", back: true });
    assert.equal(kind("Escape"), "escape");
  });

  it("has no Undo, Follow or join key: Ctrl+Z, F and J are the page's own", () => {
    assert.equal(kind("z", { mod: true }), null);
    assert.equal(kind("f"), null);
    assert.equal(kind("F"), null);
    assert.equal(kind("j"), null);
  });

  it("takes the clicker's black-screen keys and drops them: the screen never goes blank", () => {
    for (const k of ["b", "B", "."]) assert.equal(kind(k), "ignore");
  });

  it("takes every reload shortcut, so a key never reloads the page and loses the class", () => {
    // The page cancels the browser's action for each key it takes (keyboard.ts calls preventDefault on a non-null action).
    for (const [k, o] of [["F5", {}], ["F5", { shift: true }], ["F5", { mod: true }], ["F5", { mod: true, shift: true }], ["r", { mod: true }], ["R", { mod: true, shift: true }], [" ", {}], ["PageUp", {}], ["PageDown", {}]] as const) {
      assert.equal(cancelsBrowser(keyAction(key(k, o))), true, `${k} ${JSON.stringify(o)}`);
    }
    // A reload with a modifier is dropped, it is never a command.
    assert.equal(kind("F5", { mod: true }), "ignore");
    assert.equal(kind("r", { mod: true }), "ignore");
  });

  it("F5 is Start only before the start: the band turns it into nothing after", () => {
    assert.deepEqual(keyAction(key("F5")), { kind: "start-only" });
  });

  it("a held key never steps through the class: one press, one command", () => {
    for (const k of [" ", "ArrowRight", "PageDown", "F5"]) assert.equal(kind(k, { repeat: true }), "ignore");
  });

  it("while the End question is open, Space, the arrows, Page keys and F5 wait for the answer", () => {
    const waits = (a: KeyAction | null): boolean => (a === null ? false : waitsForQuestion(a));
    for (const k of [" ", "ArrowRight", "ArrowLeft", "PageUp", "PageDown", "F5"]) assert.equal(waits(keyAction(key(k))), true, k);
    assert.equal(waits(keyAction(key("ArrowLeft", { shift: true }))), true);
    for (const k of ["Escape", "Tab", "End"]) assert.equal(waits(keyAction(key(k))), false, k);
  });
});

describe("the band's buttons", () => {
  it("shows Previous, the main word, Next and End, and the main word is the clock's state", () => {
    const actions = (status: "ready" | "running" | "paused"): string[] => {
      const v = bandView(status, false);
      assert.equal(v.mode, "buttons");
      return v.mode === "buttons" ? [v.previous.action, v.main.action, v.next.action, v.end.action] : [];
    };
    assert.deepEqual(actions("ready"), ["previous", "start", "next", "end"]);
    assert.deepEqual(actions("running"), ["previous", "pause", "next", "end"]);
    assert.deepEqual(actions("paused"), ["previous", "resume", "next", "end"]);
    const v = bandView("running", false);
    assert.deepEqual(v.mode === "buttons" ? [v.previous.sub, v.next.sub, v.main.word, v.end.word] : [], ["Interval", "Interval", "Pause", "End"]);
  });

  it("asks before it ends: End class and Keep going, in words", () => {
    const v = bandView("running", true);
    assert.ok(v.mode === "ask");
    assert.deepEqual(v.mode === "ask" ? [v.question, v.endClass.action, v.endClass.sub, v.keepGoing.action] : [], ["End the class?", "end-class", "Back to the class list", "keep-going"]);
  });

  it("has one button on Class Complete, in End's place", () => {
    const v = bandView("ended", false);
    assert.deepEqual(v.mode === "finished" ? [v.close.action, v.close.word, v.close.sub] : [], ["close", "Close class", "Back to the class list"]);
    assert.equal(bandView("ended", true).mode, "finished");
  });

  it("never offers Undo, Follow, a change of clock or anything about the music", () => {
    const words: string[] = [];
    for (const [s, ask] of [["ready", false], ["running", false], ["paused", false], ["running", true], ["ended", false]] as const) {
      const v = bandView(s, ask);
      const list = v.mode === "buttons" ? [v.previous, v.main, v.next, v.end] : v.mode === "ask" ? [v.endClass, v.keepGoing] : [v.close];
      for (const b of list) words.push(b.action, b.word, b.sub ?? "");
      if (v.mode === "ask") words.push(v.question);
    }
    assert.deepEqual(words.filter((w) => /undo|follow|manual|music|sync|remote|code/i.test(w)), []);
  });
});

describe("when the band shows and hides", () => {
  const ctx = (pinned = false): M.BandContext => ({ pinned, fadeMs: M.FADE_MS });

  it("a tap while it is hidden shows it and presses nothing; the next tap presses", () => {
    const first = M.press(M.HIDDEN, 1000, ctx());
    assert.equal(first.pressed, false);
    assert.equal(first.state.phase, "shown");
    assert.equal(M.press(first.state, 1500, ctx()).pressed, true);
  });

  it("hides 3 s after the last input, fading for 300 ms, and takes no press while it fades", () => {
    let s = M.press(M.HIDDEN, 0, ctx()).state;
    assert.equal(M.nextChangeAt(s, ctx()), M.HIDE_AFTER_MS);
    s = M.tick(s, M.HIDE_AFTER_MS - 1, ctx());
    assert.equal(s.phase, "shown");
    s = M.tick(s, M.HIDE_AFTER_MS, ctx());
    assert.equal(s.phase, "fading");
    assert.equal(M.takesPresses(s, ctx()), false);
    assert.equal(M.press(s, M.HIDE_AFTER_MS + 10, ctx()).pressed, false);
    assert.equal(M.tick(s, M.HIDE_AFTER_MS + M.FADE_MS, ctx()).phase, "hidden");
  });

  it("is there and gone at once with reduced motion", () => {
    const s = M.tick(M.press(M.HIDDEN, 0, { pinned: false, fadeMs: 0 }).state, M.HIDE_AFTER_MS, { pinned: false, fadeMs: 0 });
    assert.equal(s.phase, "hidden");
  });

  it("is held by keyboard focus and by the End question", () => {
    let s = M.tabFocus(M.reveal(M.HIDDEN, 0), true, 0);
    assert.equal(M.tick(s, 60_000, ctx()).phase, "shown");
    s = M.asking(M.tabFocus(s, false, 100), true, 100);
    assert.equal(M.tick(s, 60_000, ctx()).phase, "shown");
    assert.equal(M.nextChangeAt(s, ctx()), null);
    assert.equal(M.tick(M.asking(s, false, 60_000), 60_000 + M.HIDE_AFTER_MS, ctx()).phase, "fading");
    assert.equal(M.ASK_TIMEOUT_MS, 8000);
  });

  it("is pinned before the start and on Class Complete, never while running or paused", () => {
    assert.deepEqual(["ready", "running", "paused", "ended"].map(M.isPinned), [true, false, false, true]);
    assert.equal(M.tick(M.HIDDEN, 5, ctx(true)).phase, "shown");
    assert.equal(M.tick(M.tick(M.HIDDEN, 5, ctx(true)), 99_999, ctx(true)).phase, "shown");
    assert.equal(M.takesPresses(M.HIDDEN, ctx(true)), true);
    assert.equal(M.escape(M.tick(M.HIDDEN, 5, ctx(true)), 10, ctx(true)).phase, "shown");
  });

  it("shows on a pointer move of at least 6 px, not on a nudged table; keys other than Tab and End never show it", () => {
    let s = M.pointerMove(M.HIDDEN, 100, 100, 0);
    assert.equal(s.phase, "hidden", "the first position only anchors");
    assert.equal(M.pointerMove(s, 103, 104, 1).phase, "hidden");
    s = M.pointerMove(s, 110, 100, 2);
    assert.equal(s.phase, "shown");
    assert.equal(M.keyPress(M.HIDDEN, 5).phase, "hidden");
    assert.equal(M.keyPress(s, 2000).lastInputAt, 2000);
    assert.equal(M.reveal(M.HIDDEN, 5).phase, "shown", "Tab and End show it");
  });

  it("Esc hides a shown band at once", () => {
    const shown = M.reveal(M.HIDDEN, 0);
    assert.equal(M.escape(shown, 100, { pinned: false, fadeMs: 0 }).phase, "hidden");
    assert.equal(M.escape(shown, 100, ctx()).phase, "fading");
  });
});

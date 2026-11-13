// What the band holds (core/room/band-view.ts; room-2d.md, "What is on it", "End, and its guard",
// "The class code"), and its control-word size token.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { BandRoutes } from "../../src/core/room/band-routes.ts";
import { bandView, mainCommand, mainWord, STOPS_FOLLOWING } from "../../src/core/room/band-view.ts";
import type { BandView, ButtonView } from "../../src/core/room/band-view.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ABSENT: RemoteView = { slot: "absent" };
const MUSIC: BandRoutes = { start: "music", pause: "music", resume: "music", next: "music", previous: "handover" };
const HANDOVER: BandRoutes = { start: "handover", pause: "handover", resume: "handover", next: "handover", previous: "handover" };
const buttons = (v: BandView) => {
  assert.equal(v.mode, "buttons");
  return v as Extract<BandView, { mode: "buttons" }>;
};
const words = (bs: readonly ButtonView[]): string[] => bs.map((b) => `${b.word}/${b.sub ?? ""}`);

test("the main button's word is the clock's state, and Space sends what it says", () => {
  assert.deepEqual(["ready", "running", "paused", "ended"].map((s) => mainWord(s as "ready")), ["Start", "Pause", "Resume", "Pause"]);
  assert.deepEqual(["ready", "running", "paused", "ended"].map((s) => mainCommand(s as "ready")), ["start", "pause", "resume", null]);
});

test("on the clock: Previous and Next name the interval; the main button says nothing more", () => {
  assert.deepEqual(words(buttons(bandView("running", null, ABSENT, false)).transport), ["Previous/Interval", "Pause/", "Next/Interval"]);
});

test("following: Next names the song, Previous stops following", () => {
  assert.deepEqual(words(buttons(bandView("running", MUSIC, ABSENT, false)).transport), [`Previous/${STOPS_FOLLOWING}`, "Pause/", "Next/Song"]);
});

test("when every press hands the clock over, every button says so, the main one too", () => {
  assert.deepEqual(words(buttons(bandView("paused", HANDOVER, ABSENT, false)).transport), [`Previous/${STOPS_FOLLOWING}`, `Resume/${STOPS_FOLLOWING}`, `Next/${STOPS_FOLLOWING}`]);
});

test("the phone remote slot: a button when off, a disabled one while starting, the code when on", () => {
  const sub = (r: RemoteView) => buttons(bandView("running", null, r, false)).remote;
  assert.equal(sub(ABSENT), null);
  assert.deepEqual(sub({ slot: "available", note: "none" }), { id: "remote", word: "Phone remote", sub: "Show the class code", disabled: false });
  assert.equal(sub({ slot: "available", note: "in_use" })?.sub, "In use elsewhere");
  assert.equal(sub({ slot: "available", note: "ended" })?.sub, "Phone remote ended");
  assert.deepEqual(sub({ slot: "starting" }), { id: "remote", word: "Phone remote", sub: "Getting a code", disabled: true });
  const on = (phones: 0 | 1 | 2, reconnecting = false, site?: string) => buttons(bandView("running", null, { slot: "on", joinCode: "KXPD-RMTB", phones, reconnecting, ...(site ? { site } : {}) }, false)).code;
  assert.deepEqual(on(0), { code: "KXPD-RMTB", line: "Phone remote on", address: null });
  assert.equal(on(1)?.line, "Phone connected");
  assert.equal(on(2)?.line, "2 phones connected");
  assert.equal(on(2, true)?.line, "Reconnecting");
  assert.equal(on(1, false, "https://classbeat.app")?.address, "https://classbeat.app/control#KXPD-RMTB");
});

test("the class code's state line fits 18 characters", () => {
  for (const line of ["Phone remote on", "Phone connected", "2 phones connected", "Reconnecting"]) assert.ok(line.length <= 18, line);
});

test("End asks first; the question has End class and Keep going", () => {
  assert.deepEqual(buttons(bandView("running", null, ABSENT, false)).end, { id: "end", word: "End", sub: null, disabled: false });
  const ask = bandView("running", null, ABSENT, true);
  assert.equal(ask.mode, "ask");
  if (ask.mode !== "ask") return;
  assert.equal(ask.question, "End the class?");
  assert.deepEqual([ask.endClass.id, ask.endClass.word, ask.endClass.sub], ["end-class", "End class", "Back to the class list"]);
  assert.deepEqual([ask.keepGoing.id, ask.keepGoing.word], ["keep-going", "Keep going"]);
});

test("Class Complete: only Close class, in End's place", () => {
  const v = bandView("ended", MUSIC, { slot: "on", joinCode: "KXPD-RMTB", phones: 1, reconnecting: false }, true);
  assert.deepEqual(v, { mode: "finished", close: { id: "close", word: "Close class", sub: "Back to the class list", disabled: false } });
});

test("the band's --t-control is the design token's value", () => {
  const value = (file: string): string | undefined => /--t-control:\s*([^;]+);/.exec(readFileSync(join(APP, "src", "renderer", ...file.split("/")), "utf8"))?.[1]?.trim();
  assert.ok(value("design/tokens.css"));
  assert.equal(value("room-band.css"), value("design/tokens.css"));
});

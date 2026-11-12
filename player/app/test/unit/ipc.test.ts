// IPC shape and sender checks: anything not exactly expected is refused.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClockCommand, parseDroppedFile } from "../../src/core/commands.ts";
import { MAX_CLASS_FILE_BYTES } from "../../src/core/class-file.ts";
import { isTrustedSender } from "../../src/core/ipc-policy.ts";

for (const cmd of [{ type: "start" }, { type: "pause" }, { type: "resume" }, { type: "next" }, { type: "previous" }, { type: "jump", deltaMs: 5000 }, { type: "jump", deltaMs: -5000 }]) {
  test(`command accepted: ${JSON.stringify(cmd)}`, () => assert.deepEqual(parseClockCommand(cmd), cmd));
}

const proto = Object.create({ type: "start" });
for (const bad of [
  null,
  undefined,
  "start",
  5,
  [],
  ["start"],
  {},
  proto,
  { type: "seek" },
  { type: "start", extra: 1 },
  { type: "jump" },
  { type: "jump", deltaMs: 6000 },
  { type: "jump", deltaMs: "5000" },
  { type: "jump", deltaMs: 5000, x: 1 },
  { type: "toString" },
  { type: "__proto__" },
]) {
  test(`command refused: ${JSON.stringify(bad) ?? String(bad)}`, () => assert.equal(parseClockCommand(bad), null));
}

test("dropped file: name and text only", () => {
  assert.deepEqual(parseDroppedFile({ name: "a.json", text: "{}" }), { name: "a.json", text: "{}" });
});

for (const bad of [
  null,
  { name: "a.json" },
  { text: "{}" },
  { name: "a.json", text: "{}", path: "/etc/passwd" },
  { name: 1, text: "{}" },
  { name: "a.json", text: 1 },
  { name: "x".repeat(256), text: "{}" },
  { name: "a.json", text: " ".repeat(MAX_CLASS_FILE_BYTES + 1) },
]) {
  test(`dropped file refused: ${JSON.stringify(bad)?.slice(0, 60)}`, () => assert.equal(parseDroppedFile(bad), null));
}

const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html" };
const GOOD = { senderId: 7, topFrame: true, frameUrl: "file:///app/dist/presenter.html" };

test("sender: the presenter's top frame on the presenter page is trusted", () => {
  assert.equal(isTrustedSender(GOOD, TRUSTED), true);
  assert.equal(isTrustedSender({ ...GOOD, frameUrl: `${GOOD.frameUrl}#x` }, TRUSTED), true);
});

for (const [label, facts, trusted] of [
  ["another window", { ...GOOD, senderId: 8 }, TRUSTED],
  ["a subframe", { ...GOOD, topFrame: false }, TRUSTED],
  ["another page", { ...GOOD, frameUrl: "file:///app/dist/other.html" }, TRUSTED],
  ["a remote page", { ...GOOD, frameUrl: "https://example.invalid/presenter.html" }, TRUSTED],
  ["no presenter", GOOD, { ...TRUSTED, presenterId: null }],
] as const) {
  test(`sender refused: ${label}`, () => assert.equal(isTrustedSender(facts, trusted), false));
}

// What the room window hangs on in the controller (main/controller.ts): `onOpened` fires for every
// class that opens for play and never for one that does not, and `watch` gets every pushed snapshot,
// also with no presenter attached.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { WebContents } from "electron";
import { createController } from "../../src/main/controller.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { converterExamples } from "./fixtures.ts";

const text = (): string => readFileSync(converterExamples()[0], "utf8");

test("onOpened: once per class that opens, never for a refused file or a refusal", () => {
  const c = createController(() => 0);
  let opened = 0;
  c.onOpened(() => void opened++);
  c.open("a.json", text());
  assert.equal(opened, 1);
  c.open("b.json", "not json");
  c.open("c.json", "{}");
  c.refuse("This file could not be read.");
  assert.equal(opened, 1);
  c.open("d.json", text());
  assert.equal(opened, 2);
});

test("watch: every push, with or without a presenter, the same snapshot the presenter is sent", () => {
  const c = createController(() => 0);
  const seen: Snapshot[] = [];
  c.watch((s) => void seen.push(s));
  c.open("a.json", text());
  c.command({ type: "start" });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].view?.status, "running");
  const sent: unknown[] = [];
  const wc = { isDestroyed: () => false, isCrashed: () => false, send: (_ch: string, s: unknown) => void sent.push(s) } as unknown as WebContents;
  c.attach(() => wc);
  c.command({ type: "pause" });
  c.stop();
  assert.equal(sent.at(-1), seen.at(-1));
});

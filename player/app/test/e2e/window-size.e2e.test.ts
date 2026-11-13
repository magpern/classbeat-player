// The live presenter window cannot be made smaller than 1000x720 of its content area.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ElectronApplication } from "playwright-core";
import { launch } from "./launch.ts";

let app: ElectronApplication;

before(async () => {
  ({ app } = await launch());
});
after(async () => {
  await app?.close();
});

test("the window reports a 1000x720 content minimum and refuses a smaller size", async () => {
  const r = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setContentSize(600, 400);
    return { min: w.getMinimumSize(), content: w.getContentSize() };
  });
  assert.ok(r.min[0]! >= 1000 && r.min[1]! >= 720, `minimum ${r.min.join("x")}`);
  assert.ok(r.content[0]! >= 1000 && r.content[1]! >= 720, `content ${r.content.join("x")}`);
});

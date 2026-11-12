// The music link in the running application: the three named music commands pass the bridge and
// anything else is refused; and on a system without a reader of its own (every system but
// Windows today) the application runs on the manual clock and offers nothing to follow.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { converterExamples } from "../unit/fixtures.ts";
import { launch } from "./launch.ts";

let app: ElectronApplication;
let page: Page;

before(async () => {
  ({ app, page } = await launch());
});
after(async () => {
  await app?.close();
});

interface LinkSnapshot {
  readonly link: { readonly mode: string; readonly available: boolean; readonly state: string } | null;
}

test("music commands over the bridge: only play, pause and next, by name", async () => {
  const r = await page.evaluate(async () => {
    const api = (window as unknown as { player: { command(c: unknown): Promise<unknown> } }).player;
    const accepted: boolean[] = [];
    for (const action of ["play", "pause", "next"]) accepted.push((await api.command({ type: "music", action })) !== null);
    const refused: unknown[] = [];
    for (const c of [{ type: "music", action: "previous" }, { type: "music", action: "play", extra: 1 }, { type: "music" }, { type: "music", action: "next; calc.exe" }, { type: "music", action: ["play"] }]) {
      refused.push(await api.command(c));
    }
    return { accepted, refused };
  });
  assert.deepEqual(r.accepted, [true, true, true]);
  assert.deepEqual(r.refused, [null, null, null, null, null]);
});

test("without a reader for this system the class runs on the manual clock", { skip: process.platform === "win32" }, async () => {
  const body = readFileSync(converterExamples()[0], "utf8");
  const snap = await page.evaluate(
    async (text) => {
      const api = (window as unknown as { player: { openDropped(n: string, t: string): Promise<unknown>; command(c: unknown): Promise<unknown> } }).player;
      await api.openDropped("a.json", text);
      return api.command({ type: "follow" });
    },
    body,
  );
  const link = (snap as LinkSnapshot).link;
  assert.deepEqual({ mode: link?.mode, available: link?.available, state: link?.state }, { mode: "manual", available: false, state: "Manual" });
  assert.equal(await page.locator("#follow").isHidden(), true);
});

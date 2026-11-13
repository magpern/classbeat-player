// Every state of the class list at the three window sizes (19 states, 57 renderings): the real page
// in headless Chrome over the fixture views, screenshots written to screenshots/ (CI keeps them
// for the Designer), and the spec's measurable checks on each. Needs `npm run build` first.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { check } from "./checks.ts";
import { launchChrome, openList, SHOT_DIR } from "./page.ts";
import { SIZES, STATES } from "./states.ts";

let browser: Browser;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

for (const state of STATES) {
  test(`state ${state.name}: renders at every size, passes the measurable checks`, { timeout: 120_000 }, async () => {
    for (const size of SIZES) {
      const name = `${state.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const opened = await openList(browser, size, state.view);
      try {
        if (state.type !== undefined) {
          await opened.page.focus("#filter-input");
          await opened.page.keyboard.type(state.type);
        }
        await opened.page.waitForTimeout(100);
        await opened.page.screenshot({ path: join(SHOT_DIR, `class-list-${name}.png`), animations: "disabled" });
        const report = await check(opened.page);
        assert.deepEqual(report.problems, [], name);
        // L3: at least five whole rows with the footer, wherever the titles fit one line (the spec's worst case, wide capitals, shows fewer).
        if (state.name !== "long-titles" && report.rows > 0) assert.ok(report.rows >= 5, `${name}: ${report.rows} whole rows`);
        assert.deepEqual(opened.external, [], `${name}: requests left the file system`);
        assert.deepEqual(opened.errors, [], `${name}: page errors`);
      } finally {
        await opened.close();
      }
    }
  });
}

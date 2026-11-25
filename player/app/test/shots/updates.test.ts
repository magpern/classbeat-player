// Every state of the update notice and the Settings page (docs/design/updates.md) at the three
// window sizes, on the real class list page in headless Chrome with a stand-in bridge: screenshots to
// screenshots/ for the Designer, the class list's measurable checks, and U3, U4 and U10 to U12.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "updates-<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { check } from "./checks.ts";
import { launchChrome, openList, SHOT_DIR } from "./page.ts";
import { SIZES } from "./states.ts";
import { UPDATE_STATES } from "./update-states.ts";

let browser: Browser;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

interface Facts {
  /** "Open release page" buttons a person can see (U10). */
  readonly openButtons: number;
  readonly notices: number;
  readonly settingsKey: boolean;
  /** Any text or attribute that looks like an address, and any href (U11). */
  readonly addresses: string[];
  /** The Settings page runs past the window (U3). */
  readonly settingsPastWindow: boolean;
  /** The class filter is shown (from eight classes). */
  readonly filter: boolean;
}

const facts = (page: Page): Promise<Facts> =>
  page.evaluate(() => {
    const seen = (el: Element): boolean => (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0;
    const addresses: string[] = [];
    // The page's own stylesheet link in the head is the only href; nothing a person sees has one.
    if (document.body.querySelector("[href]") !== null) addresses.push("an href");
    const ADDRESS = /http|:\/\/|github/i;
    if (ADDRESS.test(document.body.textContent ?? "")) addresses.push("address in text");
    for (const el of document.body.querySelectorAll("*")) for (const a of el.attributes) if (ADDRESS.test(a.value)) addresses.push(`address in ${a.name}`);
    const settings = document.getElementById("settings-app")!;
    const last = settings.querySelector(".switches")!.getBoundingClientRect();
    return {
      openButtons: [...document.querySelectorAll('[data-action="open-release"]')].filter(seen).length,
      notices: [...document.querySelectorAll(".notice")].filter(seen).length,
      settingsKey: document.getElementById("settings-key") !== null,
      addresses,
      settingsPastWindow: !settings.hidden && last.bottom > window.innerHeight + 1,
      filter: !document.getElementById("filter")!.hidden,
    };
  });

for (const state of UPDATE_STATES) {
  test(`updates ${state.name}: renders at every size, passes the measurable checks`, { timeout: 120_000 }, async () => {
    for (const size of SIZES) {
      const name = `${state.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(`updates-${name}`)) continue;
      const opened = await openList(browser, size, state.list, "no-preference", state.update);
      try {
        const { page } = opened;
        if (state.update !== null) await page.waitForSelector("#settings-key");
        // Two polls: whatever the bridge says has been painted.
        await page.waitForTimeout(1100);
        if (state.settings) {
          await page.keyboard.press("Control+,");
          await page.waitForSelector("#settings-app:not([hidden])");
        }
        for (const k of state.keys ?? []) await page.keyboard.press(k);
        await page.waitForTimeout(100);
        await page.screenshot({ path: join(SHOT_DIR, `updates-${name}.png`), animations: "disabled" });
        const report = await check(page);
        assert.deepEqual(report.problems, [], name);
        const f = await facts(page);
        const newer = state.update?.kind === "newer";
        // The notice: on the list, for a newer version, kept (with its button) while a new check runs.
        const notice = !state.settings && state.update?.notice != null;
        assert.equal(f.notices, notice ? 1 : 0, `${name}: notice`);
        // U10: "Open release page" only for a newer version (on Settings, only while "Newer version available" is the status), once.
        assert.equal(f.openButtons, (state.settings ? newer : notice) ? 1 : 0, `${name}: Open release page`);
        // U11: no address anywhere, no href.
        assert.deepEqual(f.addresses, [], name);
        // U12: the class gate.
        assert.equal(f.settingsKey, state.update !== null, `${name}: Settings key`);
        // U3: Settings at once, no scroll.
        assert.equal(f.settingsPastWindow, false, `${name}: Settings runs past the window`);
        // U4: with the notice, at least five whole rows with the filter shown and six without.
        if (!state.settings && report.rows > 0) assert.ok(report.rows >= (f.filter ? 5 : 6), `${name}: ${report.rows} whole rows`);
        assert.deepEqual(opened.external, [], `${name}: requests left the file system`);
        assert.deepEqual(opened.errors, [], `${name}: page errors`);
      } finally {
        await opened.close();
      }
    }
  });
}

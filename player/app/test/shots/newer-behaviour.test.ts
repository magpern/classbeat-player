// The "needs a newer player" rows on the real class list page (docs/design/class-list.md): the row's
// meta line and the selected row's footer detail read the one sentence, Start is disabled with no
// Enter hint, and a click on it or Enter sends nothing to the shell. Headless Chrome over the fixture
// views; no network. Needs `npm run build`.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { NEEDS_NEWER_STATES } from "./newer-states.ts";
import { launchChrome, openList } from "./page.ts";

const SENTENCE = "This class needs a newer version of the player";
let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

for (const name of ["source-selected", "major-selected"]) {
  test(`needs-newer-${name}: sentence on the row and in the footer, Start disabled and silent`, async () => {
    const s = NEEDS_NEWER_STATES.find((x) => x.name === `needs-newer-${name}`)!;
    const o = await openList(browser, [1280, 800], s.view);
    try {
      await o.page.click(`#row-${s.select}`);
      assert.equal((await o.page.locator(`#row-${s.select} .m`).innerText()).trim(), SENTENCE);
      assert.equal((await o.page.locator("#foot-detail").innerText()).trim(), SENTENCE);
      const start = o.page.locator(".foot button.primary");
      assert.equal(await start.isDisabled(), true);
      assert.equal(await start.getAttribute("aria-describedby"), "foot-detail");
      assert.doesNotMatch(await start.innerText(), /Enter/);
      await o.page.keyboard.press("Enter");
      await start.click({ force: true });
      assert.deepEqual(await o.calls(), []);
    } finally {
      await o.close();
    }
  });
}

// The same row not selected: the sentence is on the row (the meta line) and nowhere else, and the footer
// holds no needs-newer detail until the row is selected.
for (const name of ["source", "major"]) {
  test(`needs-newer-${name}: not selected, the row carries the sentence and the footer does not`, async () => {
    const s = NEEDS_NEWER_STATES.find((x) => x.name === `needs-newer-${name}`)!;
    const o = await openList(browser, [1280, 800], s.view);
    try {
      const metas = await o.page.locator(".row .m").allInnerTexts();
      assert.equal(metas.filter((m) => m.trim() === SENTENCE).length, 1, "only the unknown row says it");
      assert.equal(metas.at(-1)?.trim(), SENTENCE, "the last row is the unknown one");
      assert.ok(!(await o.page.locator("#foot-detail").allInnerTexts()).some((t) => t.includes(SENTENCE)), "no sentence in the footer");
      assert.deepEqual(await o.calls(), []);
    } finally {
      await o.close();
    }
  });
}

// The mix class's link line in the scene's own text (docs/design/swedebeat.md W2, scene.md S15): the real room page in headless Chrome
// with the scene mounted (no reduced motion), given the longest line before the start at all ten room sizes. The line is one line, inside
// the safe area (5 % of every edge), and no other part of the rail touches it. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<w>x<h>")
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import type { RoomFrame } from "../../src/core/room/frame.ts";
import { launchChrome } from "./page.ts";
import { frameOf, openRoom } from "./room-page.ts";

const SIZES: readonly (readonly [number, number])[] = [
  [2560, 1080], [1920, 1080], [1280, 720], [1680, 1050], [1280, 800],
  [1650, 1080], [1620, 1080], [1440, 1080], [1024, 768], [1280, 1024],
];
const LONGEST = "Press Start · Swedebeat cannot be connected here";
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;
const frame: RoomFrame = { ...frameOf("before-start-manual"), link: null, mix: { text: LONGEST, shape: "square" } };

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

for (const [w, h] of SIZES) {
  test(`the longest mix line in the scene's text, before the start, at ${w}x${h}`, async () => {
    if (only && !only.test(`${w}x${h}`)) return;
    const o = await openRoom(browser, { size: [w, h], frame, remote: { slot: "absent" } });
    try {
      // The page runs on a fake clock: let it run until the first scene frame has been drawn.
      for (let i = 0; i < 40 && (await o.page.evaluate(() => document.documentElement.dataset.scene)) !== "on"; i++) await o.page.clock.runFor(100);
      assert.equal(await o.page.evaluate(() => document.documentElement.dataset.scene), "on", `${w}x${h}: the scene is showing`);
      const m = await o.page.evaluate(() => {
        const link = document.querySelector<HTMLElement>("#text .rail .link")!;
        const r = link.getBoundingClientRect();
        const others = [...document.querySelectorAll<HTMLElement>("#text .rail > .ink")].filter((e) => e !== link && e.offsetParent !== null && e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
        return {
          text: link.textContent,
          left: r.left, right: r.right, height: r.height, lines: link.getClientRects().length,
          font: parseFloat(getComputedStyle(link).fontSize),
          // Whatever else the rail shows, to the left of the link, must end before it starts.
          overlap: others.filter((b) => b.right > r.left + 0.5 && b.left < r.right).length,
          width: window.innerWidth,
        };
      });
      assert.equal(m.text, LONGEST);
      assert.ok(m.lines === 1 && m.height < m.font * 2.6, `${w}x${h}: one line (${m.lines} boxes, ${m.height.toFixed(1)} px high at ${m.font.toFixed(1)} px)`);
      assert.ok(m.right <= m.width * 0.95 + 0.5, `${w}x${h}: the line ends at x=${m.right.toFixed(0)}, past the safe edge ${(m.width * 0.95).toFixed(0)}`);
      assert.ok(m.left >= m.width * 0.05 - 0.5, `${w}x${h}: the line starts at x=${m.left.toFixed(0)}, before the safe edge`);
      assert.equal(m.overlap, 0, `${w}x${h}: another part of the rail overlaps the line`);
      assert.deepEqual(o.errors, [], `${w}x${h}: page errors`);
    } finally {
      await o.page.context().close();
    }
  });
}

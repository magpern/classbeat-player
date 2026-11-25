// The scene's text layer on the real room page (docs/design/scene.md "Layout", S2): web/src/room/room.css is loaded beside the layer's own
// CSS and must not move or recolour it (#823 cue, #828, #829 colours). At 5:4, 4:3 and 16:9 the current cue ends where the spec puts it and
// does not meet the next cue; the metrics and the clock stand at their spec positions; the link, the labels and the segment name are
// `--light-1`. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<w>x<h>")
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { launchChrome } from "./page.ts";
import { frameOf, openRoom } from "./room-page.ts";

// narrow: 3:2 and narrower use the narrow layout (scene.md "Layout"); cueBottom in vh; metrics [left vw, top vh].
const SIZES = [
  { w: 1279, h: 1023, narrow: true, cueBottom: 80.3, metrics: [33, 39.3] },
  { w: 1280, h: 960, narrow: true, cueBottom: 80.3, metrics: [33, 39.3] },
  { w: 1920, h: 1080, narrow: false, cueBottom: 68.4, metrics: [27, 12] },
] as const;
const LIGHT_1 = "rgb(246, 244, 239)";
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

for (const s of SIZES) {
  test(`the scene's text keeps its spec places and colours on the room page at ${s.w}x${s.h}`, { timeout: 180_000 }, async () => {
    if (only && !only.test(`${s.w}x${s.h}`)) return;
    const o = await openRoom(browser, { size: [s.w, s.h], frame: frameOf("running"), scene: true });
    try {
      for (let i = 0; i < 40 && (await o.page.evaluate(() => document.documentElement.dataset.scene)) !== "on"; i++) await o.page.clock.runFor(100);
      assert.equal(await o.page.evaluate(() => document.documentElement.dataset.scene), "on", "the scene is showing");
      const m = await o.page.evaluate(() => {
        const box = (sel: string) => {
          const e = document.querySelector<HTMLElement>(sel);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const shown = (e: HTMLElement) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
        const colours = (sel: string, skip = "") => [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => shown(e) && !(skip && e.closest(skip))).map((e) => `${e.textContent} ${getComputedStyle(e).color}`);
        return {
          narrow: document.querySelector("#text")!.classList.contains("narrow"),
          cue: box("#text .cue"), next: box("#text .n-cue"), metrics: box("#text .metrics"), clock: box("#text .clock"),
          link: colours("#text .rail .link"), seg: colours("#text .rail .seg"),
          // The gel's own labels are ink on the zone colour; every other label is light-1.
          lbl: colours("#text .lbl", ".gel"),
        };
      });
      const px = (vh: number) => (vh * s.h) / 100;
      const pxw = (vw: number) => (vw * s.w) / 100;
      const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1, `${s.w}x${s.h}: ${what} is ${a.toFixed(1)}, spec ${b.toFixed(1)}`);
      assert.equal(m.narrow, s.narrow, "layout");
      assert.ok(m.cue && m.next && m.metrics && m.clock, "cue, next cue, metrics and clock are in the text layer");
      near(m.cue.bottom, px(s.cueBottom), `the cue's bottom (${s.cueBottom} vh)`);
      assert.ok(m.next.bottom <= m.cue.top || m.next.top >= m.cue.bottom || m.next.right <= m.cue.left || m.next.left >= m.cue.right, `${s.w}x${s.h}: the next cue (${m.next.top.toFixed(0)}-${m.next.bottom.toFixed(0)}) meets the current cue (${m.cue.top.toFixed(0)}-${m.cue.bottom.toFixed(0)})`);
      near(m.metrics.left, pxw(s.metrics[0]), `the metrics' left (${s.metrics[0]} vw)`);
      near(m.metrics.top, px(s.metrics[1]), `the metrics' top (${s.metrics[1]} vh)`);
      near(m.clock.right, pxw(95), "the clock's right edge (95 vw)");
      near(m.clock.top, px(10.9), "the clock's top (10.9 vh)");
      assert.ok(m.link.length > 0 && m.lbl.length > 0, "a link and labels are shown");
      if (!s.narrow) assert.ok(m.seg.length > 0, "the segment name is shown");
      for (const c of [...m.link, ...m.lbl, ...m.seg]) assert.ok(c.endsWith(LIGHT_1), `${s.w}x${s.h}: "${c}" is not --light-1 ${LIGHT_1}`);
      assert.deepEqual(o.errors, [], "page errors");
    } finally {
      await o.page.context().close();
    }
  });
}

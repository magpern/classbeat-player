// The room screen's link line for a mix class (docs/design/swedebeat.md, "Room screen"): the real
// room page in headless Chrome, given each of the spec's six lines in the frame's `mix`, with a
// screenshot of each to screenshots/room-mix-<state>-<w>x<h>.png for the design review and the
// numbers of collect.js and ink.js to screenshots/room-mix-measure.json: W2 (label tier, cap height
// at least 2.0 % of the screen height, one line, inside the safe area) and W3 (contrast at least
// 4.5:1), and the shape of each state. The longest line runs at all ten room sizes. Needs `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import type { MixLine } from "../../src/core/mix/mix-line.ts";
import type { RoomFrame } from "../../src/core/room/frame.ts";
import { launchChrome, SHOT_DIR } from "./page.ts";
import { frameOf, openRoom } from "./room-page.ts";
import { probePage, tierText } from "./room-measure.ts";
import type { TextMeasure } from "./room-measure.ts";

const THREE: readonly (readonly [number, number])[] = [[1920, 1080], [1280, 1024], [1024, 768]];
const ALL_SIZES: readonly (readonly [number, number])[] = [
  [2560, 1080], [1920, 1080], [1280, 720], [1680, 1050], [1280, 800],
  [1650, 1080], [1620, 1080], [1440, 1080], [1024, 768], [1280, 1024],
];

/** The marker each shape draws (swedebeat.md): white or grey, round, hollow or square. */
interface Look {
  readonly color: string;
  readonly round: boolean;
  readonly ring: boolean;
}
const WHITE = "rgb(246, 244, 239)";
const GREY = "rgb(189, 186, 178)";
const LOOKS: Record<MixLine["shape"], Look> = {
  dot: { color: WHITE, round: true, ring: false },
  circle: { color: GREY, round: true, ring: true },
  square: { color: GREY, round: false, ring: false },
  news: { color: WHITE, round: false, ring: false },
};

interface MixShot {
  readonly name: string;
  readonly fixture: "before-start-manual" | "manual";
  readonly mix: MixLine;
  readonly sizes: readonly (readonly [number, number])[];
}

const SHOTS: readonly MixShot[] = [
  { name: "ready", fixture: "before-start-manual", mix: { text: "Mix ready", shape: "dot" }, sizes: THREE },
  { name: "downloading", fixture: "before-start-manual", mix: { text: "Downloading the mix 63%", shape: "circle" }, sizes: THREE },
  { name: "fallback", fixture: "before-start-manual", mix: { text: "Press Start · Swedebeat is not connected", shape: "square" }, sizes: THREE },
  { name: "fallback-longest", fixture: "before-start-manual", mix: { text: "Press Start · Swedebeat cannot be connected here", shape: "square" }, sizes: ALL_SIZES },
  { name: "playing", fixture: "manual", mix: { text: "Playing the mix", shape: "dot" }, sizes: THREE },
  { name: "fell-back", fixture: "manual", mix: { text: "Mix still downloading", shape: "news" }, sizes: THREE },
  { name: "fell-back-signed-out", fixture: "manual", mix: { text: "Signed out of Swedebeat", shape: "news" }, sizes: THREE },
  { name: "manual-clock", fixture: "manual", mix: { text: "Manual clock", shape: "square" }, sizes: THREE },
];

const frame = (s: MixShot): RoomFrame => ({ ...frameOf(s.fixture), link: null, mix: s.mix });

/** The line's words, colour and marker as drawn; one line per difference from the spec. */
function lookOf(page: Page, mix: MixLine): Promise<string[]> {
  return page.evaluate(
    ({ text, look }) => {
      const out: string[] = [];
      const links = document.querySelectorAll(".rail .link");
      if (links.length !== 1) return [`${links.length} link lines`];
      const el = links[0] as HTMLElement;
      if (el.textContent !== text) out.push(`text "${el.textContent}"`);
      const c = getComputedStyle(el);
      if (c.color !== look.color) out.push(`colour ${c.color}`);
      if (c.backgroundColor !== "rgba(0, 0, 0, 0)") out.push(`a plate ${c.backgroundColor}`);
      const m = getComputedStyle(el, "::before");
      const round = m.borderTopLeftRadius === "50%";
      if (round !== look.round) out.push(`marker radius ${m.borderTopLeftRadius}`);
      const ring = m.backgroundImage.startsWith("radial-gradient");
      if (ring !== look.ring) out.push(`marker image ${m.backgroundImage}`);
      if (!ring && m.backgroundColor !== look.color) out.push(`marker colour ${m.backgroundColor}`);
      return out;
    },
    { text: mix.text, look: LOOKS[mix.shape] },
  );
}

let browser: Browser;
let probe: Page;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;
const numbers: Record<string, TextMeasure[]> = {};

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
  probe = await probePage(browser);
});
after(async () => {
  writeFileSync(join(SHOT_DIR, "room-mix-measure.json"), `${JSON.stringify(numbers, null, 2)}\n`);
  for (const [name, ms] of Object.entries(numbers)) for (const m of ms) console.log(`room-mix ${name}: "${m.text}" cap ${(m.cap * 100).toFixed(2)}% contrast ${m.contrast?.toFixed(1) ?? "none"}`);
  await browser?.close();
});

for (const shot of SHOTS) {
  test(`mix line ${shot.name}: screenshots, W2 and W3 at each size`, { timeout: 300_000 }, async () => {
    for (const size of shot.sizes) {
      const name = `${shot.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const o = await openRoom(browser, { size, frame: frame(shot), remote: { slot: "absent" } });
      try {
        await o.page.screenshot({ path: join(SHOT_DIR, `room-mix-${name}.png`) });
        const measured: TextMeasure[] = [];
        const problems = [...(await lookOf(o.page, shot.mix)), ...(await tierText(o.page, probe, size, ".rail .link", measured))];
        numbers[name] = measured;
        assert.equal(measured.length, 1, `${name}: the line is measured once`);
        assert.equal(measured[0]!.tier, "label", `${name}: the label tier`);
        assert.deepEqual(problems, [], name);
        assert.deepEqual(o.external, [], `${name}: requests left the file system`);
        assert.deepEqual(o.errors, [], `${name}: page errors`);
      } finally {
        await o.close();
      }
    }
  });
}

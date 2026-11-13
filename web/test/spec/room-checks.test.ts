// The spec's measurable checks (docs/design/room-2d.md, C1 to C8) on the real screen, in Chrome:
// every state, and the worst case of every text slot, at all ten supported room sizes, plus the
// room preview inside the presenter window. Writes a PNG of every shot to screenshots/ (CI keeps
// them as an artefact for the Designer) and prints a fixture-by-size summary.
//   SPEC_ONLY=<regex>   only the shots whose name ("running-1920x1080") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { STATE_NAMES, WORST_NAMES } from "../../src/fixtures/index.ts";
import { WEB_DIR, launch, newPage } from "../lib/browser.ts";
import { checkShot, shotName } from "../lib/measure.ts";
import type { Shot, ShotResult } from "../lib/measure.ts";

// Every room size and ratio the spec supports (room-2d.md, "Layout"): from 21:9 down to 5:4, the
// smallest of each layout, and both sides of the 3:2 switch point.
export const SIZES: readonly (readonly [number, number])[] = [
  [2560, 1080], // 21:9, the widest
  [1920, 1080], // 16:9
  [1280, 720], // 16:9, the smallest room size
  [1680, 1050], // 16:10
  [1280, 800], // 16:10, small
  [1650, 1080], // 1.53:1, the narrowest ratio of the wide layout
  [1620, 1080], // 3:2, the widest ratio of the narrow layout
  [1440, 1080], // 4:3
  [1024, 768], // 4:3, the smallest
  [1280, 1024], // 5:4, the narrowest
];

const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots");

const SHOTS: Shot[] = [
  ...[...STATE_NAMES, ...WORST_NAMES].flatMap((fixture) => SIZES.map(([width, height]) => ({ fixture, width, height, room: true }))),
  // The room preview in the presenter window (room-2d.md, "Narrow presenter preview").
  { fixture: "running", width: 480, height: 270, room: false },
  { fixture: "worst-running", width: 480, height: 270, room: false },
].filter((s) => !ONLY || ONLY.test(shotName(s)));

async function pool<T, R>(items: readonly T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]);
    }),
  );
  return out;
}

function summary(results: readonly ShotResult[]): string {
  const files = [...new Set(results.map((r) => r.shot.fixture))];
  const sizes = [...new Set(results.map((r) => `${r.shot.width}x${r.shot.height}`))];
  const pct = (v: number): string => (Number.isFinite(v) ? (v * 100).toFixed(1) : "-");
  const lines = files.map((f) => {
    const cells = sizes.map((z) => {
      const hit = results.find((r) => r.shot.fixture === f && `${r.shot.width}x${r.shot.height}` === z);
      if (!hit) return "";
      return `${hit.failed ? `**${hit.failed} FAIL**` : "ok"}${hit.shot.room ? ` ${pct(hit.heroCap)}/${pct(hit.valueCap)}` : ""}`;
    });
    return `| ${f} | ${cells.join(" | ")} |`;
  });
  return `Summary (each cell: result, then the smallest cap height of the countdown / of a value, % of the screen height)\n\n| Fixture | ${sizes.join(" | ")} |\n|---|${sizes.map(() => "---").join("|")}|\n${lines.join("\n")}`;
}

describe("room screen: the spec's measurable checks (room-2d.md C1 to C8)", () => {
  let browser: Browser;
  let results: ShotResult[] = [];

  before(async () => {
    browser = await launch();
    const probes: Page[] = [];
    mkdirSync(SHOT_DIR, { recursive: true });
    try {
      results = await pool(SHOTS, JOBS, async (s) => {
        const probe = await newPage(browser, { width: 100, height: 100 });
        probes.push(probe);
        const r = await checkShot(browser, probe, s);
        writeFileSync(join(SHOT_DIR, `${shotName(s)}.png`), r.png);
        await probe.context().close();
        return r;
      });
    } finally {
      await browser.close();
    }
    console.log(`\n${summary(results)}\n`);
  });

  after(() => {
    results = [];
  });

  it("has shots to check", () => {
    assert.ok(SHOTS.length > 0, "SPEC_ONLY matched no shot");
  });

  for (const s of SHOTS) {
    it(shotName(s), () => {
      const r = results.find((x) => shotName(x.shot) === shotName(s));
      assert.ok(r, "the shot was not taken");
      const failing = r.rows.filter((row) => row.result !== "ok");
      assert.deepEqual(
        failing.map((row) => `${row.tier} "${row.text}": ${row.result}`),
        [],
      );
    });
  }
});

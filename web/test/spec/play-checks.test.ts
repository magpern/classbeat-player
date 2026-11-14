// The web player page's measurable checks (docs/design/play.md, P1 to P10) on the real page, in
// Chrome, on the fake site with a paused clock: every state of the room screen at the four reference
// sizes (and the smallest phone each way up where the spec says), the phone with the browser's bars
// showing, and the band with reduced motion. Writes a PNG of every shot to screenshots/play/ (CI keeps
// screenshots/ as an artefact for the Designer).
//   SPEC_ONLY=<regex>   only the shots whose name ("play-running-390x844") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { WEB_DIR, newPage } from "../lib/browser.ts";
import { CLASS_ID, classScript, openPlay } from "../lib/play-fake.ts";
import { checkPlayRoom } from "../lib/play-measure.ts";
import type { PlayResult } from "../lib/play-measure.ts";
import { SIZES, SMALLEST, STATES } from "../lib/play-states.ts";
import type { PlayState } from "../lib/play-states.ts";
import { launchOffline } from "../lib/site-fake.ts";

const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots", "play");

interface Shot {
  readonly state: PlayState;
  readonly size: readonly [number, number];
  /** "reduced": the system asks for reduced motion. */
  readonly motion?: "reduced";
}
const nameOf = (s: Shot): string => `play-${s.state.name}${s.motion ? "-reduced" : ""}-${s.size[0]}x${s.size[1]}`;

const byName = (n: string): PlayState => STATES.find((s) => s.name === n) as PlayState;
const SHOTS: Shot[] = [
  ...STATES.flatMap((state) => SIZES.map((size) => ({ state, size }))),
  ...STATES.filter((s) => s.small).flatMap((state) => SMALLEST.map((size) => ({ state, size }))),
  // The browser's bars showing: no full screen to go to, a 390 x 664 portrait screen.
  { state: byName("running"), size: [390, 664] as const },
  // The band appears and goes at once with reduced motion.
  { state: byName("running-band"), size: [390, 844] as const, motion: "reduced" as const },
].filter((s) => !ONLY || ONLY.test(nameOf(s)));

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

async function shoot(browser: Browser, s: Shot): Promise<PlayResult> {
  const probe = await newPage(browser, { width: 100, height: 100 });
  const [width, height] = s.size;
  const site = await openPlay(browser, { width, height, hash: `#${CLASS_ID}`, script: classScript(s.state.doc), before: s.state.before, reducedMotion: s.motion === "reduced", clock: s.state.clock });
  try {
    await s.state.stage(site.page, s.size);
    const r = await checkPlayRoom(site.page, probe, width, height);
    const problems = site.console.filter((c) => !c.includes("Failed to load resource"));
    return problems.length ? { ...r, rows: [...r.rows, ...problems.map((p) => ({ tier: "console", text: p.slice(0, 40), result: "FAIL console output" }))] } : r;
  } finally {
    await site.context.close();
    await probe.context().close();
  }
}

describe("web player page: the spec's measurable checks (play.md P1 to P10)", () => {
  let browser: Browser;
  let results: { shot: Shot; result: PlayResult }[] = [];

  before(async () => {
    browser = await launchOffline();
    mkdirSync(SHOT_DIR, { recursive: true });
    try {
      results = await pool(SHOTS, JOBS, async (shot) => {
        const result = await shoot(browser, shot);
        writeFileSync(join(SHOT_DIR, `${nameOf(shot)}.png`), result.png);
        return { shot, result };
      });
    } finally {
      await browser.close();
    }
    const failed = results.filter((r) => r.result.rows.some((x) => x.result !== "ok")).map((r) => nameOf(r.shot));
    const smallest = Object.entries(results.reduce<Record<string, number>>((acc, r) => {
      for (const [t, m] of Object.entries(r.result.margins)) acc[t] = Math.min(acc[t] ?? Infinity, m);
      return acc;
    }, {})).map(([t, m]) => `${t} ${((m - 1) * 100).toFixed(0)} %`).join(", ");
    console.log(`\nplay: ${results.length} shots, ${failed.length} failing${failed.length ? `: ${failed.join(", ")}` : ""}\nsmallest margin over each floor: ${smallest}\n`);
  });

  after(() => {
    results = [];
  });

  it("has shots to check", () => {
    assert.ok(SHOTS.length > 0, "SPEC_ONLY matched no shot");
  });

  it("covers every state of the spec at each reference size", () => {
    if (ONLY) return;
    for (const state of STATES) for (const [w, h] of SIZES) assert.ok(results.some((r) => nameOf(r.shot) === `play-${state.name}-${w}x${h}`), `${state.name} ${w}x${h}`);
  });

  for (const s of SHOTS) {
    it(nameOf(s), () => {
      const r = results.find((x) => nameOf(x.shot) === nameOf(s));
      assert.ok(r, "the shot was not taken");
      assert.ok(r.result.rows.length > 0, "nothing was measured");
      assert.deepEqual(
        r.result.rows.filter((row) => row.result !== "ok").map((row) => `${row.tier} "${row.text}": ${row.result}`),
        [],
      );
    });
  }
});


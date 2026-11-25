// The rider page's measurable checks over a set of states (docs/design/rider.md R1 to R12,
// sensors.md S1 to S7): each state at its sizes on the real page, the fake site and live process
// and a paused clock. Writes a PNG of every shot to screenshots/rider/ (CI keeps screenshots/ as an
// artefact for the Designer) and prints the smallest margin over each floor.
//   SPEC_ONLY=<regex>   only the shots whose name ("running-390x844") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import riderChecks from "../spec/page/rider-checks.js";
import { WEB_DIR, newPage } from "./browser.ts";
import { checkCompanion } from "./companion-measure.ts";
import type { Row } from "./measure.ts";
import { launchOffline, openRider } from "./rider-fake.ts";
import { CLASS_SIZES, FORM_SIZES } from "./rider-stages.ts";
import type { StateDef } from "./rider-stages.ts";

interface Shot {
  readonly state: string;
  readonly width: number;
  readonly height: number;
}
const nameOf = (s: Shot): string => `${s.state}-${s.width}x${s.height}`;
const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots", "rider");
const TIERS = ["gel", "hero", "value", "read", "minor", "label"];
/** Every floored text stays at least 5 % over its floor on the real page (rider.md, "Measurable checks"). */
const HEADROOM = 1.05;

function marginTable(margins: ReadonlyMap<string, Record<string, number>>): string {
  const rows = [...margins].map(([size, t]) => `| ${size} | ${TIERS.map((k) => (t[k] === undefined ? "-" : `${((t[k] - 1) * 100).toFixed(1)} %`)).join(" | ")} |`);
  return `Smallest cap height over its R1 floor, per size and tier\n\n| Size | ${TIERS.join(" | ")} |\n|---|${TIERS.map(() => "---").join("|")}|\n${rows.join("\n")}`;
}

/** One test per shot: every state of `states` at the class sizes, a form or a sheet in portrait. */
export function checkRiderShots(title: string, states: Readonly<Record<string, StateDef>>): void {
  const shots: Shot[] = Object.entries(states)
    .flatMap(([state, def]) => (def.sizes ?? (def.form ? FORM_SIZES : CLASS_SIZES)).map(([width, height]) => ({ state, width, height })))
    .filter((s) => !ONLY || ONLY.test(nameOf(s)));
  const margins = new Map<string, Record<string, number>>();
  const note = (s: Shot, m: Readonly<Record<string, number>>): void => {
    const size = `${s.width}x${s.height}`;
    const t = margins.get(size) ?? {};
    for (const [tier, v] of Object.entries(m)) t[tier] = Math.min(t[tier] ?? Infinity, v);
    margins.set(size, t);
  };

  async function shoot(browser: Browser, s: Shot): Promise<Row[]> {
    const def = states[s.state];
    const f = await openRider(browser, { width: s.width, height: s.height, clock: true, ...def.open });
    const probe = await newPage(browser, { width: 100, height: 100 });
    try {
      await def.stage(f);
      const r = await checkCompanion(f.page, probe, s.width, s.height, { run: riderChecks, form: def.form ?? false });
      writeFileSync(join(SHOT_DIR, `${nameOf(s)}.png`), r.png);
      note(s, r.margins);
      const thin = Object.entries(r.margins)
        .filter(([, m]) => m < HEADROOM)
        .map(([tier, m]) => ({ tier: "margin", text: tier, result: `FAIL ${((m - 1) * 100).toFixed(1)} % over its floor, under 5 %` }));
      const external = f.external.map((u) => ({ tier: "network", text: u.slice(0, 40), result: "FAIL external request" }));
      return [...r.rows, ...thin, ...external];
    } catch (e) {
      return [{ tier: "stage", text: s.state, result: `FAIL ${String(e).slice(0, 300)}` }];
    } finally {
      await probe.context().close();
      await f.context.close();
    }
  }

  describe(title, () => {
    let browser: Browser;
    const results = new Map<string, Row[]>();

    before(async () => {
      browser = await launchOffline();
      mkdirSync(SHOT_DIR, { recursive: true });
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.max(1, JOBS) }, async () => {
          for (let i = next++; i < shots.length; i = next++) results.set(nameOf(shots[i]), await shoot(browser, shots[i]));
        }),
      );
      console.log(`\n${marginTable(margins)}\n`);
    });

    after(async () => {
      await browser.close();
    });

    it("has shots to check", () => {
      assert.ok(shots.length > 0, "SPEC_ONLY matched no shot");
    });

    for (const s of shots) {
      it(nameOf(s), () => {
        const rows = results.get(nameOf(s));
        assert.ok(rows, "the shot was not taken");
        assert.deepEqual(
          rows.filter((r) => r.result !== "ok").map((r) => `${r.tier} "${r.text}": ${r.result}`),
          [],
        );
      });
    }
  });
}

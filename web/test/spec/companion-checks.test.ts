// The companion's measurable checks (docs/design/companion.md, K1 to K10) on the real page, on the
// fake site and live process with recorded messages and a paused clock: every state, and the
// worst case of every text slot, in portrait and landscape at the reference phone and at the
// smallest supported size of each orientation. Writes a PNG of every shot to
// screenshots/companion/ (CI keeps screenshots/ as an artefact for the Designer).
//   SPEC_ONLY=<regex>   only the shots whose name ("running-390x844") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { parseInbound } from "../../src/companion/core/wire.ts";
import { WEB_DIR, newPage } from "../lib/browser.ts";
import { checkCompanion } from "../lib/companion-measure.ts";
import { launchOffline, openCompanion } from "../lib/companion-fake.ts";
import type { Fake, OpenOptions } from "../lib/companion-fake.ts";
import { SECRET43, examples } from "../lib/live-examples.ts";
import type { Row } from "../lib/measure.ts";

const SIZES = [[390, 844], [844, 390], [360, 640], [640, 360]] as const;
const TOKEN = `cbp_ctl_${SECRET43}`;
type State = Record<string, unknown>;
const recorded = (name: string): State => examples("companion-state", "valid").find((e) => e.name.endsWith(`/${name}.json`))?.value as State;

/** A recorded state changed, and checked again so every shot stays on the contract. */
function variant(base: State, change: State): State {
  const s = { ...base, ...change };
  if (parseInbound(JSON.stringify(s))?.type !== "companion_state") throw new Error(`off the contract: ${JSON.stringify(change)}`);
  return s;
}

const FOLLOWING = recorded("following-locked");
const MANUAL = variant(FOLLOWING, { link: { mode: "manual", state: "manual", canUndo: false, announcement: null }, allowed: ["pause", "skip", "nudge"] });
// The schema's limits for every text slot (companion-state.schema.json): a zone name of 80, a cue
// of 120, a title and an artist of 200, three next rows.
const long = (words: string, n: number): string => words.repeat(Math.ceil(n / words.length)).slice(0, n).trimEnd().padEnd(n, "x");
const zone = (number: number) => ({ number, name: long("Sustained threshold climb with standing surges ", 80) });
const WORST = variant(MANUAL, {
  now: { index: 4, zone: zone(4), cue: long("Stay seated, push through the climb and keep the cadence ", 120), remainingMs: 46000 },
  next: [800000, 860000, 980000].map((startMs, k) => ({ startMs, lengthMs: 60000, zone: zone([2, 5, 7][k]), cue: long("Recover with shoulders down ", 120) })),
  nextSong: { atMs: 830000, title: long("An Extremely Long Song Title (Extended Club Remix) ", 200), artist: long("The Featured Artist and Orchestra ", 200) },
});

type Stage = (f: Fake) => Promise<void>;
const at = (f: Fake, sel: string): Promise<unknown> => f.page.waitForSelector(sel);
const inState = (state: State, then?: Stage): Stage => async (f) => {
  await f.page.clock.runFor(100);
  f.live.send(state);
  await at(f, ".run");
  if (then) await then(f);
};
const lastCommandId = (f: Fake): string => (JSON.parse(f.live.sent.filter((t) => t.includes('"command"')).at(-1) ?? "{}") as { id: string }).id;
async function holdSkip(f: Fake, ms: number): Promise<void> {
  const box = await f.page.locator("[data-action=skip]").boundingBox();
  assert.ok(box);
  await f.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await f.page.mouse.down();
  await f.page.clock.runFor(ms);
}
const refused: Stage = async (f) => {
  await f.page.click("[data-action=pause]");
  f.live.send({ v: 1, type: "ack", id: lastCommandId(f), result: "refused", reason: "would_stop_following" });
  await at(f, ".notice");
};
const dropPhone: Stage = async (f) => {
  f.live.refuse = true;
  await f.live.close(1006);
  await at(f, "text=Reconnecting");
};

interface StateDef {
  readonly open?: Partial<OpenOptions>;
  readonly stage: Stage;
}
const live = { stored: TOKEN };
const STATES: Readonly<Record<string, StateDef>> = {
  code: { stage: (f) => at(f, "text=Sign in to steer").then(() => undefined) },
  "code-signed-in": { open: { signedIn: true, hash: "#BCDF-GHJK" }, stage: (f) => at(f, "text=Signed in on this phone").then(() => undefined) },
  "code-no-wake": { open: { hash: "#BCDF-GHJK", wake: "absent" }, stage: (f) => at(f, "text=Set your screen to stay on").then(() => undefined) },
  "code-wrong": {
    open: { hash: "#BCDF-GHJK", answers: { control: [{ status: 403, body: { error: "invalid_code" } }] } },
    stage: async (f) => {
      await f.page.fill("#control-code", "lmnpqrst");
      await f.page.click("[data-action=control]");
      await at(f, "#control-code-error");
    },
  },
  full: {
    open: { hash: "#BCDF-GHJK", answers: { control: [{ status: 403, body: { error: "controllers_full" } }] } },
    stage: async (f) => {
      await f.page.fill("#control-code", "lmnpqrst");
      await f.page.click("[data-action=control]");
      await at(f, "text=Two phones already steer this class");
    },
  },
  connecting: { open: live, stage: (f) => at(f, "text=Connecting to the class").then(() => undefined) },
  dropped: { open: live, stage: inState(FOLLOWING, async (f) => (f.live.send({ v: 1, type: "ended", reason: "dropped" }), void (await at(f, "[data-action=get_control]")))) },
  ended: { open: live, stage: inState(FOLLOWING, async (f) => (f.live.send({ v: 1, type: "ended", reason: "host_ended" }), void (await at(f, "[data-action=get_control]")))) },
  running: { open: live, stage: inState(FOLLOWING) },
  manual: { open: live, stage: inState(MANUAL) },
  "off-list": { open: live, stage: inState(variant(FOLLOWING, { link: { mode: "following", state: "off_the_list", canUndo: false, announcement: null } })) },
  "last-interval": { open: live, stage: inState(variant(FOLLOWING, { next: [], nextSong: null })) },
  paused: { open: live, stage: inState(recorded("manual-paused-last-interval")) },
  "before-start": { open: live, stage: inState(recorded("not-started")) },
  resynced: { open: live, stage: inState(recorded("resync-announced")) },
  finished: { open: live, stage: inState(variant(MANUAL, { status: "ended", allowed: [] })) },
  holding: { open: live, stage: inState(MANUAL, (f) => holdSkip(f, 400)) },
  skipped: {
    open: live,
    stage: inState(MANUAL, async (f) => {
      await holdSkip(f, 850);
      await f.page.mouse.up();
      f.live.send({ v: 1, type: "ack", id: lastCommandId(f), result: "applied", reason: null });
      await at(f, ".top .note");
    }),
  },
  refused: { open: live, stage: inState(MANUAL, refused) },
  reconnecting: { open: live, stage: inState(FOLLOWING, dropPhone) },
  lost: {
    open: live,
    stage: inState(FOLLOWING, async (f) => {
      await dropPhone(f);
      await f.page.clock.runFor(10_500);
      await at(f, "text=Not connected");
    }),
  },
  "host-away": { open: live, stage: inState(FOLLOWING, async (f) => (f.live.send({ v: 1, type: "host_status", connected: false }), void (await at(f, "text=Computer not connected")))) },
  "host-lost": {
    open: live,
    stage: inState(FOLLOWING, async (f) => {
      f.live.send({ v: 1, type: "host_status", connected: false });
      await at(f, "text=Computer not connected");
      await f.page.clock.runFor(10_500);
      await at(f, ".plate");
    }),
  },
  worst: { open: live, stage: inState(WORST) },
  "worst-notice": { open: live, stage: inState(WORST, refused) },
};

interface Shot {
  readonly state: string;
  readonly width: number;
  readonly height: number;
}
const nameOf = (s: Shot): string => `${s.state}-${s.width}x${s.height}`;
const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots", "companion");
const SHOTS: Shot[] = Object.keys(STATES)
  .flatMap((state) => SIZES.map(([width, height]) => ({ state, width, height })))
  .filter((s) => !ONLY || ONLY.test(nameOf(s)));

async function shoot(browser: Browser, s: Shot): Promise<Row[]> {
  const def = STATES[s.state];
  const f = await openCompanion(browser, { width: s.width, height: s.height, clock: true, ...def.open });
  const probe = await newPage(browser, { width: 100, height: 100 });
  try {
    await def.stage(f);
    const r = await checkCompanion(f.page, probe, s.width, s.height);
    writeFileSync(join(SHOT_DIR, `${nameOf(s)}.png`), r.png);
    const external = f.external.map((u) => ({ tier: "network", text: u.slice(0, 40), result: "FAIL external request" }));
    return [...r.rows, ...external];
  } catch (e) {
    return [{ tier: "stage", text: s.state, result: `FAIL ${String(e).slice(0, 200)}` }];
  } finally {
    await probe.context().close();
    await f.context.close();
  }
}

describe("companion page: the spec's measurable checks (companion.md K1 to K10)", () => {
  let browser: Browser;
  const results = new Map<string, Row[]>();

  before(async () => {
    browser = await launchOffline();
    mkdirSync(SHOT_DIR, { recursive: true });
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.max(1, JOBS) }, async () => {
        for (let i = next++; i < SHOTS.length; i = next++) results.set(nameOf(SHOTS[i]), await shoot(browser, SHOTS[i]));
      }),
    );
  });

  after(async () => {
    await browser.close();
  });

  it("has shots to check", () => {
    assert.ok(SHOTS.length > 0, "SPEC_ONLY matched no shot");
  });

  for (const s of SHOTS) {
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

// The rider page's measurable checks (docs/design/rider.md, R1 to R12) on the real page, on the fake
// site and live process with recorded `rider_state` messages and a paused clock: every state of the
// spec and the worst cases, the class and ending states at the four sizes, the forms in portrait.
// Each stage also checks the state's words. Writes a PNG of every shot to screenshots/rider/ (CI
// keeps screenshots/ as an artefact for the Designer) and prints the smallest margin over each floor.
//   SPEC_ONLY=<regex>   only the shots whose name ("running-390x844") matches
//   SPEC_JOBS=<n>       shots checked at the same time (default 4)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { parseInbound } from "../../src/rider/core/wire.ts";
import { WEB_DIR, newPage } from "../lib/browser.ts";
import { checkCompanion } from "../lib/companion-measure.ts";
import type { Reply } from "../lib/companion-fake.ts";
import { SECRET43, examples } from "../lib/live-examples.ts";
import type { Row } from "../lib/measure.ts";
import { launchOffline, openRider } from "../lib/rider-fake.ts";
import type { RiderFake, RiderOptions } from "../lib/rider-fake.ts";
import riderChecks from "./page/rider-checks.js";

const CLASS_SIZES = [[390, 844], [844, 390], [360, 640], [640, 360]] as const;
const FORM_SIZES = [[390, 844], [360, 640]] as const;
const TOKEN = `cbp_rdr_${SECRET43}`;
const JOINED: Reply = { status: 200, body: { riderToken: TOKEN } };
type State = Record<string, unknown>;
const recorded = (name: string): State => examples("rider-state", "valid").find((e) => e.name.endsWith(`/${name}.json`))?.value as State;

/** A recorded state changed, and checked again so every shot stays on the contract. */
function variant(base: State, change: State): State {
  const s = { ...base, ...change };
  if (parseInbound(JSON.stringify(s))?.type !== "rider_state") throw new Error(`off the contract: ${JSON.stringify(change)}`);
  return s;
}

const RUNNING = recorded("running-three-coming");
const NOW = RUNNING.now as State;
const Z4 = { number: 4, name: "Threshold", effort: { ftpPct: [88, 94], hrmaxPct: [85, 92], rpe: [7, 8] } };
const RUN = variant(RUNNING, { now: { ...NOW, zone: Z4, remainingMs: 70_000 }, classRemainingMs: 1_421_000 });
const long = (words: string, n: number): string => words.repeat(Math.ceil(n / words.length)).slice(0, n).trimEnd().padEnd(n, "x");
const NAME80 = long("Maximal aerobic power with standing efforts and short seated recoveries between ", 80);
const zone = (number: number, effort: State = { ftpPct: [112, 150], hrmaxPct: [80, 100], rpe: [10, 10] }): State => ({ number, name: NAME80, effort });
const WORST = variant(RUN, {
  lengthMs: 7_200_000,
  classRemainingMs: 7_138_000,
  now: { index: 4, zone: zone(7), position: "standing", test: { kind: "ftp", minutes: 20 }, remainingMs: 3_538_000 },
  next: [6, 7, 3].map((n, k) => ({ startMs: 4_000_000 + k * 1_200_000, lengthMs: 1_200_000, zone: zone(n), position: "seated" })),
});
const NICK24 = "W".repeat(24);

type Stage = (f: RiderFake) => Promise<void>;
const at = async (f: RiderFake, sel: string): Promise<void> => void (await f.page.waitForSelector(sel));

/** The state's words (rider.md, "States" and "Wording"): every phrase in `shown` on the page, none in `hidden`. */
const words = (shown: readonly string[], hidden: readonly string[] = []): Stage => async (f) => {
  const body = (await f.page.locator("body").innerText()).replace(/\s+/g, " ");
  for (const w of shown) assert.ok(body.includes(w), `"${w}" is not on the page: ${body.slice(0, 300)}`);
  for (const w of hidden) assert.ok(!body.includes(w), `"${w}" is on the page`);
};
const then = (...stages: Stage[]): Stage => async (f) => {
  for (const s of stages) await s(f);
};

/** Types into the form and presses Join the class. */
const joinWith = (o: { nickname?: string; ftp?: string; hrmax?: string; code?: string } = {}): Stage => async (f) => {
  if (o.code !== undefined) await f.page.fill("#rider-code", o.code);
  await f.page.fill("#rider-nickname", o.nickname ?? "Anna");
  if (o.ftp !== undefined) await f.page.fill("#rider-ftp", o.ftp);
  if (o.hrmax !== undefined) await f.page.fill("#rider-hrmax", o.hrmax);
  await f.page.click("[data-action=join]");
};
/** Joined as Anna (with FTP 250 and maximum heart rate 185 unless told otherwise), then shown a state. */
const inClass = (state: State | null, numbers = true, nickname = "Anna"): Stage => async (f) => {
  await joinWith(numbers ? { nickname, ftp: nickname === NICK24 ? "600" : "250", hrmax: nickname === NICK24 ? "230" : "185" } : { nickname })(f);
  await f.page.clock.runFor(100);
  if (state) {
    await f.live.ready();
    f.live.send(state);
    await at(f, ".run");
  }
};
const send = (msg: State, sel: string): Stage => async (f) => {
  f.live.send(msg);
  await at(f, sel);
};

interface StateDef {
  readonly open?: Partial<RiderOptions>;
  readonly stage: Stage;
  /** A form: checked in portrait, and it may scroll down. */
  readonly form?: boolean;
}
const IN = { answers: [JOINED] };
const STATES: Readonly<Record<string, StateDef>> = {
  // Before and while joining (forms, portrait).
  enter: { form: true, stage: words(["Join the class", "Class code KXPD-RMTB", "Your instructor sees your nickname. FTP and max heart rate stay on this phone and are never sent.", "Nickname", "FTP, in watts (optional)", "Max heart rate, in bpm (optional)", "Remember on this phone", "Off"], ["Forget"]) },
  "enter-remembered": { form: true, open: { remembered: '{"ftp":250,"hrmax":185}' }, stage: then(async (f) => assert.equal(await f.page.inputValue("#rider-ftp"), "250"), words(["On", "Forget"])) },
  "enter-error": { form: true, stage: then(joinWith({ nickname: "", ftp: "2500" }), (f) => at(f, "#rider-ftp-error"), words(["Type a nickname, 1 to 24 characters.", "FTP is a whole number from 50 to 600."])) },
  "enter-no-code": { form: true, open: { hash: "" }, stage: words(["Type the class code from the room screen.", "Class code"], ["KXPD-RMTB"]) },
  "no-storage": { form: true, open: { noStorage: true }, stage: words(["Not available on this phone", "Off"]) },
  "too-many": { form: true, open: { answers: [{ status: 429, body: { error: "too_many_requests" } }] }, stage: then(joinWith(), (f) => at(f, ".plate"), words(["Too many tries.", "Wait a minute and try again."])) },
  "went-wrong": { form: true, open: { answers: [{ status: 500, body: { error: "internal_error" } }] }, stage: then(joinWith(), (f) => at(f, ".plate"), words(["Something went wrong.", "Try again."])) },
  joining: { form: true, open: { ...IN, welcome: null }, stage: then(joinWith({ ftp: "250", hrmax: "185" }), (f) => at(f, ".field.dim"), words(["Joining the class", "Getting you into the class", "Joining…"])) },
  away: { form: true, open: IN, stage: then(inClass(RUN), async (f) => f.live.close(4401), (f) => at(f, ".plate"), words(["You were away too long", "Join again to get back in."]), async (f) => assert.equal(await f.page.inputValue("#rider-nickname"), "Anna")) },
  "my-numbers": { form: true, open: IN, stage: then(inClass(RUN), (f) => f.page.click("[data-action=my_numbers]"), (f) => at(f, "[data-action=done]"), words(["My numbers", "Used on this phone to work out your effort. Never sent.", "Done"])) },
  "worst-form": { form: true, open: { remembered: '{"ftp":250,"hrmax":185}' }, stage: then(joinWith({ nickname: NICK24, ftp: "9999", hrmax: "9999" }), (f) => at(f, "#rider-hrmax-error"), words(["Max heart rate is a whole number from 80 to 230."])) },
  // Refused, and the ending pages (all sizes).
  "not-joined": { open: { answers: [{ status: 403, body: { error: "cannot_join" } }] }, stage: then(joinWith(), (f) => at(f, "[data-action=retry]"), words(["Could not join", "Check the code with your instructor.", "KXPD-RMTB", "Try again"])) },
  "no-connection": { open: { answers: [{ status: 0, fail: true }] }, stage: then(joinWith(), (f) => at(f, "[data-action=retry]"), words(["No connection", "Check your phone's network, then try again."])) },
  waiting: { open: { ...IN, welcome: false }, stage: then(inClass(null), (f) => at(f, ".work"), words(["Waiting for the instructor", "You are in. The class shows here when the instructor is back.", "Joined as Anna"])) },
  removed: { open: IN, stage: then(inClass(RUN), send({ v: 1, type: "ended", reason: "dropped" }, "h1"), words(["The instructor removed you from this class", "To join again, scan the code on the room screen."], ["Try again", "Join the class"])) },
  ended: { open: IN, stage: then(inClass(RUN), send({ v: 1, type: "ended", reason: "host_ended" }, "h1"), words(["The class has ended", "You can close this page."])) },
  // In the class (all sizes).
  running: { open: IN, stage: then(inClass(RUN), words(["Joined as Anna", "23:41", "left", "Threshold", "Interval left", "1:10", "Position", "Seated", "Power", "220–235", "W", "Heart rate", "157–170", "bpm", "RPE", "7–8", "Next", "Endurance", "My numbers"], ["%", "Add your FTP"])) },
  "running-percent": { open: IN, stage: then(inClass(RUN, false), words(["88–94%", "FTP", "85–92%", "max", "Add your FTP and max heart rate in My numbers to see watts and beats."])) },
  "ftp-test": { open: IN, stage: then(inClass(variant(RUN, { now: { ...NOW, zone: { number: 5, name: "VO2 max", effort: { ftpPct: null, hrmaxPct: null, rpe: [9, 10] } }, test: { kind: "ftp", minutes: 20 }, remainingMs: 720_000 } })), words(["FTP test, 20 min", "VO2 max", "12:00", "9–10"], ["Power"])) },
  "before-start": { open: IN, stage: then(inClass(variant(RUN, { status: "not_started", classMs: 0, classRemainingMs: 2_700_000 })), words(["First zone", "First interval", "45:00", "class"])) },
  paused: { open: IN, stage: then(inClass(variant(RUN, { status: "paused" })), words(["Paused", "Interval left", "1:10"]), (f) => at(f, ".gel.down")) },
  holding: { open: IN, stage: then(inClass(variant(RUN, { status: "holding", now: { ...NOW, zone: Z4, remainingMs: 0 } })), words(["Until the next song", "0:00"])) },
  "last-interval": { open: IN, stage: then(inClass(variant(RUN, { next: [] })), words(["Last interval", "End of class"])) },
  finished: { open: IN, stage: then(inClass(variant(RUN, { status: "ended" })), words(["Class complete", "45:00 ridden", "Thank you for riding."], ["My numbers", "Power"])) },
  "host-away": { open: IN, stage: then(inClass(RUN), send({ v: 1, type: "host_status", connected: false }, ".count.est"), words(["Waiting for the instructor", "Interval left, not live"]), (f) => at(f, ".gel.down")) },
  reconnecting: {
    open: IN,
    stage: then(inClass(RUN), async (f) => {
      f.live.refuse = true;
      await f.live.close(1006);
      await at(f, ".count.est");
    }, words(["Reconnecting", "Interval left, not live"])),
  },
  "no-wake": { open: { ...IN, wake: "absent" }, stage: then(inClass(RUN), words(["Set your screen to stay on"])) },
  worst: { open: IN, stage: then(inClass(WORST, true, NICK24), words(["FTP test, 20 min", "58:58", "1:58:58", "Standing", "W"])) },
  "worst-percent": { open: IN, stage: then(inClass(variant(WORST, { now: { ...(WORST.now as State), test: null } }), false, NICK24), words(["112–150%", "80–100%", "Add your FTP"])) },
};

interface Shot {
  readonly state: string;
  readonly width: number;
  readonly height: number;
}
const nameOf = (s: Shot): string => `${s.state}-${s.width}x${s.height}`;
const ONLY = process.env.SPEC_ONLY ? new RegExp(process.env.SPEC_ONLY) : null;
const JOBS = Number(process.env.SPEC_JOBS ?? 4);
const SHOT_DIR = join(WEB_DIR, "screenshots", "rider");
const SHOTS: Shot[] = Object.entries(STATES)
  .flatMap(([state, def]) => (def.form ? FORM_SIZES : CLASS_SIZES).map(([width, height]) => ({ state, width, height })))
  .filter((s) => !ONLY || ONLY.test(nameOf(s)));

const MARGINS = new Map<string, Record<string, number>>();
function noteMargins(s: Shot, m: Readonly<Record<string, number>>): void {
  const size = `${s.width}x${s.height}`;
  const t = MARGINS.get(size) ?? {};
  for (const [tier, v] of Object.entries(m)) t[tier] = Math.min(t[tier] ?? Infinity, v);
  MARGINS.set(size, t);
}
function marginTable(): string {
  const tiers = ["gel", "hero", "value", "minor", "label"];
  const rows = [...MARGINS].map(([size, t]) => `| ${size} | ${tiers.map((k) => (t[k] === undefined ? "-" : `${((t[k] - 1) * 100).toFixed(1)} %`)).join(" | ")} |`);
  return `Smallest cap height over its R1 floor, per size and tier\n\n| Size | ${tiers.join(" | ")} |\n|---|${tiers.map(() => "---").join("|")}|\n${rows.join("\n")}`;
}
/** Every floored text stays at least 5 % over its floor on the real page (rider.md, "Measurable checks"). */
const HEADROOM = 1.05;

async function shoot(browser: Browser, s: Shot): Promise<Row[]> {
  const def = STATES[s.state];
  const f = await openRider(browser, { width: s.width, height: s.height, clock: true, ...def.open });
  const probe = await newPage(browser, { width: 100, height: 100 });
  try {
    await def.stage(f);
    const r = await checkCompanion(f.page, probe, s.width, s.height, { run: riderChecks, form: def.form ?? false });
    writeFileSync(join(SHOT_DIR, `${nameOf(s)}.png`), r.png);
    noteMargins(s, r.margins);
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

describe("rider page: the spec's measurable checks (rider.md R1 to R12)", () => {
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
    console.log(`\n${marginTable()}\n`);
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

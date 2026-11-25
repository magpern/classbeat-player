// The rider page's states for the spec checks (docs/design/rider.md, sensors.md): the recorded
// `rider_state` messages and their variants, and the stages that bring the page to a state on the
// fake site and live process (rider-fake.ts). Shared by rider-checks.test.ts and
// rider-sensor-checks.test.ts.
import assert from "node:assert/strict";
import { parseInbound } from "../../src/rider/core/wire.ts";
import type { Reply } from "./companion-fake.ts";
import { SECRET43, examples } from "./live-examples.ts";
import type { RiderFake, RiderOptions } from "./rider-fake.ts";

export const CLASS_SIZES = [[390, 844], [844, 390], [360, 640], [640, 360]] as const;
export const FORM_SIZES = [[390, 844], [360, 640]] as const;
export const TOKEN = `cbp_rdr_${SECRET43}`;
export const JOINED: Reply = { status: 200, body: { riderToken: TOKEN } };
export type State = Record<string, unknown>;
export const recorded = (name: string): State => examples("rider-state", "valid").find((e) => e.name.endsWith(`/${name}.json`))?.value as State;

/** A recorded state changed, and checked again so every shot stays on the contract. */
export function variant(base: State, change: State): State {
  const s = { ...base, ...change };
  if (parseInbound(JSON.stringify(s))?.type !== "rider_state") throw new Error(`off the contract: ${JSON.stringify(change)}`);
  return s;
}

export const RUNNING = recorded("running-three-coming");
export const NOW = RUNNING.now as State;
export const Z4 = { number: 4, name: "Threshold", effort: { ftpPct: [88, 94], hrmaxPct: [85, 92], rpe: [7, 8] } };
export const RUN = variant(RUNNING, { now: { ...NOW, zone: Z4, remainingMs: 70_000 }, classRemainingMs: 1_421_000 });
const long = (words: string, n: number): string => words.repeat(Math.ceil(n / words.length)).slice(0, n).trimEnd().padEnd(n, "x");
export const NAME80 = long("Maximal aerobic power with standing efforts and short seated recoveries between ", 80);
export const zone = (number: number, effort: State = { ftpPct: [112, 150], hrmaxPct: [80, 100], rpe: [10, 10] }): State => ({ number, name: NAME80, effort });
export const WORST = variant(RUN, {
  lengthMs: 7_200_000,
  classRemainingMs: 7_138_000,
  now: { index: 4, zone: zone(7), position: "standing", test: { kind: "ftp", minutes: 20 }, remainingMs: 3_538_000 },
  next: [6, 7, 3].map((n, k) => ({ startMs: 4_000_000 + k * 1_200_000, lengthMs: 1_200_000, zone: zone(n), position: "seated" })),
});
export const NICK24 = "W".repeat(24);

export type Stage = (f: RiderFake) => Promise<void>;
export const at = async (f: RiderFake, sel: string): Promise<void> => void (await f.page.waitForSelector(sel));

/** The state's words (rider.md, "States" and "Wording"): every phrase in `shown` on the page, none in `hidden`. */
export const words = (shown: readonly string[], hidden: readonly string[] = []): Stage => async (f) => {
  const body = (await f.page.locator("body").innerText()).replace(/\s+/g, " ");
  for (const w of shown) assert.ok(body.includes(w), `"${w}" is not on the page: ${body.slice(0, 300)}`);
  for (const w of hidden) assert.ok(!body.includes(w), `"${w}" is on the page`);
};
export const then = (...stages: Stage[]): Stage => async (f) => {
  for (const s of stages) await s(f);
};

/** Types into the form and presses Join the class. */
export const joinWith = (o: { nickname?: string; ftp?: string; hrmax?: string; code?: string } = {}): Stage => async (f) => {
  if (o.code !== undefined) await f.page.fill("#rider-code", o.code);
  await f.page.fill("#rider-nickname", o.nickname ?? "Anna");
  if (o.ftp !== undefined) await f.page.fill("#rider-ftp", o.ftp);
  if (o.hrmax !== undefined) await f.page.fill("#rider-hrmax", o.hrmax);
  await f.page.click("[data-action=join]");
};
/** Joined as Anna (with FTP 250 and maximum heart rate 185 unless told otherwise), then shown a state. */
export const inClass = (state: State | null, numbers = true, nickname = "Anna"): Stage => async (f) => {
  await joinWith(numbers ? { nickname, ftp: nickname === NICK24 ? "600" : "250", hrmax: nickname === NICK24 ? "230" : "185" } : { nickname })(f);
  await f.page.clock.runFor(100);
  if (state) {
    await f.live.ready();
    f.live.send(state);
    await at(f, ".run");
  }
};
export const send = (msg: State, sel: string): Stage => async (f) => {
  f.live.send(msg);
  await at(f, sel);
};

export interface StateDef {
  readonly open?: Partial<RiderOptions>;
  readonly stage: Stage;
  /** A form: checked in portrait, and it may scroll down. */
  readonly form?: boolean;
  /** The sizes it is shot at, where not the class sizes (or the form's, for a form). */
  readonly sizes?: readonly (readonly [number, number])[];
}
export const IN = { answers: [JOINED] };

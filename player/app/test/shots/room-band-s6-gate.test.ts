// The strict S6 gate on the room screen with the control band shown, hidden and the join sheet up (scene.md,
// "The flash budget"; room-2d.md, "Motion and reduced motion"; issue #585). The measure is the scene's, counted by
// its own pure module: the screen's relative luminance (linear light) in 40 regions, a change is a monotone run of
// more than 10 % of its larger end (each direction counts), and more than 3 changes in any sliding second fails.
// The page is the real room page in headless Chrome on Playwright's paused clock, stepped 50 ms at a time and read
// from a screenshot at each step; each scenario scripts the inputs of a person (and the phone remote's slot).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { findChanges, mostInASecond } from "../../../scene/render/tools/luminance-steps.ts";
import { launchChrome } from "./page.ts";
import { decodePng, regionLuminance, REGIONS } from "./png-luma.ts";
import { frameOf, on, openRoom, ROUTES, wiggle } from "./room-page.ts";
import type { RoomOpen } from "./room-page.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const STEP_MS = 50;
type Script = readonly [atMs: number, what: string, act: (r: RoomOpen) => Promise<void>][];
const key = (k: string) => (r: RoomOpen) => r.page.keyboard.press(k);
let moves = 0;
const move = (r: RoomOpen) => wiggle(r.page, 300 + 40 * (++moves % 5), 200);

interface Result {
  readonly most: number;
  readonly region: string;
  readonly marks: number;
}

/** Plays a script and counts the changes of every region over the whole run. */
async function measure(name: string, o: { frame: ReturnType<typeof frameOf>; alone?: boolean; remote?: ReturnType<typeof on> }, script: Script, totalMs: number): Promise<Result> {
  const r = await openRoom(browser, { size: [640, 360], frame: o.frame, remote: o.remote ?? on(1), alone: o.alone });
  try {
    const times: number[] = [];
    const series: number[][] = [];
    let next = 0;
    for (let t = 0; t <= totalMs; t += STEP_MS) {
      while (next < script.length && script[next]![0] <= t) await script[next++]![2](r);
      times.push(t);
      series.push(regionLuminance(decodePng(await r.page.screenshot({ animations: "disabled" })), REGIONS));
      await r.run(STEP_MS);
    }
    assert.deepEqual([r.errors, r.external], [[], []]);
    let worst: Result = { most: 0, region: "", marks: 0 };
    let marks = 0;
    REGIONS.forEach(([region], i) => {
      const changes = findChanges(times, series.map((s) => s[i]!));
      const most = mostInASecond(changes);
      marks = Math.max(marks, changes.length);
      if (most > worst.most) worst = { most, region, marks: 0 };
    });
    const result = { ...worst, marks };
    console.log(`S6 gate: ${name}: at most ${result.most} changes in any second (region "${result.region || "none"}"), ${result.marks} in the run`);
    return result;
  } finally {
    await r.close();
  }
}

const RUNNING = frameOf("running", ROUTES.following);

test("running: the band shown, hidden and shown again; at most 3 changes in any second in every region", async () => {
  const res = await measure(
    "running, band",
    { frame: RUNNING },
    [
      [500, "a hand on the mouse: the band shows", move],
      [1500, "the mouse again", move],
      [4500, "the band has gone; a tap on the table shows it again", move],
      [4800, "a key restarts the 3 s", key("a")],
      [8500, "the End question", key("End")],
      [9000, "Esc answers it", key("Escape")],
    ],
    14_000,
  );
  assert.ok(res.most <= 3, `${res.most} changes in a second in ${res.region}`);
});

test("before the start with the join sheet up and a new code: the sheet, the plate and the band keep to the cap", async () => {
  const res = await measure(
    "before the start, sheet and band",
    { frame: frameOf("before-start") },
    [
      [700, "J closes the sheet", key("j")],
      [900, "J opens it again", key("j")],
      [2000, "a new code and its plate", (r) => r.pushRemote({ slot: "on", joinCode: "WXYZ-1234", phones: 0, reconnecting: false, site: "https://classbeat.example" })],
      [3000, "the phone connects", (r) => r.pushRemote(on(1))],
      [4000, "Esc closes the sheet", key("Escape")],
    ],
    14_000,
  );
  assert.ok(res.most <= 3, `${res.most} changes in a second in ${res.region}`);
});

test("paused and finished with two displays, the band goes by its own mark", async () => {
  for (const fixture of ["paused", "finished"]) {
    const res = await measure(`${fixture}, band`, { frame: frameOf(fixture), alone: false, remote: on(0) }, [[400, "the band", move], [1000, "the mouse again", move]], 6000);
    assert.ok(res.most <= 3, `${fixture}: ${res.most} changes in a second in ${res.region}`);
  }
});

test("the gate can fail: a band toggled every 100 ms, past the scheduler, is counted", async () => {
  const toggle = (r: RoomOpen): Promise<void> =>
    r.page.evaluate(() => {
      const band = document.querySelector(".band")!;
      band.setAttribute("data-phase", band.getAttribute("data-phase") === "shown" ? "hidden" : "shown");
    });
  const flicker: Script = Array.from({ length: 40 }, (_, i) => [i * 100, "toggle", toggle] as const);
  const res = await measure("negative control", { frame: RUNNING }, [[0, "start", move], ...flicker], 4000);
  assert.ok(res.most > 3, `the gate counted only ${res.most}`);
});

// Every state of the web player page's room screen (docs/design/play.md, "States"), and how to reach
// it on the fake site with a paused clock: the class, the steps a person takes and the sizes it is
// checked at. The checks and the flows both use this table.
import type { Page } from "playwright-core";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import { WORST_FIXTURES } from "../../src/fixtures/worst.ts";
import type { Class } from "../../src/room/input.ts";

export const BASE_DOC = STATE_FIXTURES.running.doc as Class;
/** The worst class: an 80-character zone name beside three targets, a 120-character cue with long words, 80-character titles. */
export const WORST_DOC = WORST_FIXTURES["worst-off-list"].doc as Class;
/** The worst class's long test interval, with the 80-character names around it, is its 61st. */
const WORST_INTERVAL = 60;

/** The four reference sizes of every state, and the smallest phone each way up (the states in `small`). */
export const SIZES = [[390, 844], [844, 390], [768, 1024], [1024, 768]] as const;
export const SMALLEST = [[360, 640], [640, 360]] as const;

/** A stand-in for a browser that refuses the Screen Wake Lock. */
export const WAKE_REFUSED = `Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => Promise.reject(new DOMException("refused", "NotAllowedError")) } });`;

export interface PlayState {
  readonly name: string;
  readonly doc: Class;
  /** An init script, run in the page before its own. */
  readonly before?: string;
  /** The steps a person takes once the class is open and before the start. */
  readonly stage: (page: Page, size: readonly [number, number]) => Promise<void>;
  /** Also checked at 360 x 640 and 640 x 360. */
  readonly small: boolean;
  /** False: the page runs on the browser's own clock (a reload needs it: a faked clock hides the navigation's type). */
  readonly clock?: false;
}

/** Waits for the class to be open: the band, pinned with Start. */
export const opened = (page: Page): Promise<unknown> => page.waitForSelector('.controls[data-phase="shown"] [data-action="start"]');

/** Real time for the colour to cross and the white edge to go (CSS animations are not on the page's clock). */
export const rest = (page: Page): Promise<void> => page.waitForTimeout(900);

/** Runs the page's clock on, and flushes what it drew. */
export async function tickBy(page: Page, ms: number): Promise<void> {
  await page.clock.runFor(ms);
  await page.evaluate(() => void document.body.getBoundingClientRect());
}

/** Next, pressed `n` times before the start: the starting point moves by an interval each time. */
async function stepTo(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) await page.keyboard.press("ArrowRight");
}

/** Start, then the 3 s and 300 ms the band takes to go: the class runs, the band is hidden. */
export async function started(page: Page, nexts = 0): Promise<void> {
  await opened(page);
  await stepTo(page, nexts);
  await page.click('[data-action="start"]');
  await tickBy(page, 3500);
  await rest(page);
}

/** A tap where no button is: the band shows. */
export async function tapped(page: Page, size: readonly [number, number]): Promise<void> {
  await page.mouse.click(size[0] / 2, size[1] / 3);
  await tickBy(page, 50);
}

const running = (nexts = 0): PlayState["stage"] => (page) => started(page, nexts);

async function ended(page: Page, doc: Class): Promise<void> {
  await started(page);
  await page.clock.fastForward(doc.class.length_ms);
  await tickBy(page, 500);
  await rest(page);
}

async function reloaded(page: Page): Promise<void> {
  await opened(page);
  await page.reload();
  await opened(page);
  await rest(page);
}

export const STATES: readonly PlayState[] = [
  { name: "before-start", doc: BASE_DOC, stage: async (p) => { await opened(p); await rest(p); }, small: true },
  { name: "running", doc: BASE_DOC, stage: running(), small: true },
  { name: "running-band", doc: BASE_DOC, stage: async (p, s) => { await started(p); await tapped(p, s); await rest(p); }, small: true },
  { name: "paused", doc: BASE_DOC, stage: async (p, s) => { await started(p); await tapped(p, s); await p.click('[data-action="pause"]'); await tickBy(p, 50); await rest(p); }, small: true },
  { name: "end-asked", doc: BASE_DOC, stage: async (p) => { await started(p); await p.keyboard.press("End"); await tickBy(p, 50); await rest(p); }, small: true },
  { name: "finished", doc: BASE_DOC, stage: (p) => ended(p, BASE_DOC), small: false },
  { name: "wake-refused", doc: BASE_DOC, before: WAKE_REFUSED, stage: running(), small: false },
  { name: "reloaded", doc: BASE_DOC, stage: reloaded, small: false, clock: false },
  { name: "worst", doc: WORST_DOC, stage: running(WORST_INTERVAL), small: true },
  { name: "worst-band", doc: WORST_DOC, stage: async (p) => { await started(p, WORST_INTERVAL); await p.keyboard.press("End"); await tickBy(p, 50); await rest(p); }, small: true },
  { name: "worst-before-start", doc: WORST_DOC, stage: async (p) => { await opened(p); await rest(p); }, small: true },
];

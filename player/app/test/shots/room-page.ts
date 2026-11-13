// The real room page (dist/room.html: the web lane's room screen and the player's control band) in
// headless Chrome, with a stand-in for the room preload that serves a fixed frame and phone remote
// slot and records what the page sends. Time is Playwright's clock, paused, so the score stands
// still between pictures and the band's 3 s can be stepped exactly. No Electron, no network.
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { FIXTURES } from "../../../../web/src/fixtures/index.ts";
import type { BandRoutes } from "../../src/core/room/band-routes.ts";
import type { RoomFrame } from "../../src/core/room/frame.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";
import { APP_DIR } from "./page.ts";

export const SITE = "https://classbeat.example";
export const JOIN = "KXPD-RMTB";

const CLOCK: BandRoutes = { start: "clock", pause: "clock", resume: "clock", next: "clock", previous: "clock" };
export const ROUTES = {
  clock: CLOCK,
  /** Following and locked, the music app can be sent commands. */
  following: { start: "music", pause: "music", resume: "music", next: "music", previous: "handover" } as BandRoutes,
  /** Following, but the music app cannot be sent commands: every press hands the clock over. */
  handover: { start: "handover", pause: "handover", resume: "handover", next: "handover", previous: "handover" } as BandRoutes,
};

/** A web fixture as the shell sends it: with the band's routes and the link's `available` flag. */
export function frameOf(fixture: string, band: BandRoutes = CLOCK, available = true): RoomFrame {
  const f = FIXTURES[fixture];
  if (!f) throw new Error(`no fixture ${fixture}`);
  return { ...f, link: f.link ? { ...f.link, available } : null, band } as unknown as RoomFrame;
}

export const on = (phones: 0 | 1 | 2 = 0, reconnecting = false): RemoteView => ({ slot: "on", joinCode: JOIN, phones, reconnecting, site: SITE });

const STUB = `
  window.__calls = [];
  const copy = (v) => Promise.resolve(v === null ? null : JSON.parse(JSON.stringify(v)));
  const cmd = (name) => () => { window.__calls.push(name); return copy(window.__frame); };
  window.room = {
    state: () => copy(window.__frame),
    onUpdate: (cb) => { window.__push = cb; },
    start: cmd("start"), pause: cmd("pause"), resume: cmd("resume"), previous: cmd("previous"), next: cmd("next"),
    forward: cmd("forward"), back: cmd("back"), undo: cmd("undo"), follow: cmd("follow"),
    endClass: () => { window.__calls.push("endClass"); return Promise.resolve(true); },
    remoteState: () => copy(window.__remote),
    startRemote: () => { window.__calls.push("startRemote"); return copy(window.__remote); },
    stopRemote: () => { window.__calls.push("stopRemote"); return copy(window.__remote); },
    onRemote: (cb) => { window.__pushRemote = cb; },
  };
`;

export interface RoomOpen {
  readonly page: Page;
  calls(): Promise<string[]>;
  /** The shell's push of a new frame or slot. */
  push(f: RoomFrame): Promise<void>;
  pushRemote(v: RemoteView): Promise<void>;
  /** Steps the paused clock (the band's timers and the screen's frames). */
  run(ms: number): Promise<void>;
  phase(): Promise<string>;
  readonly errors: string[];
  readonly external: string[];
  close(): Promise<void>;
}

export interface RoomOpenOptions {
  readonly size: readonly [number, number];
  readonly frame: RoomFrame;
  readonly remote?: RemoteView;
  /** false: the desktop spans a second display (the presenter's). */
  readonly alone?: boolean;
  readonly reducedMotion?: boolean;
  readonly touch?: boolean;
}

export async function openRoom(browser: Browser, o: RoomOpenOptions): Promise<RoomOpen> {
  const context = await browser.newContext({
    viewport: { width: o.size[0], height: o.size[1] },
    deviceScaleFactor: 1,
    reducedMotion: o.reducedMotion ? "reduce" : "no-preference",
    hasTouch: o.touch === true,
  });
  await context.addInitScript("globalThis.__name = (f) => f;");
  await context.addInitScript(STUB);
  await context.addInitScript(`window.__frame = ${JSON.stringify(o.frame)}; window.__remote = ${JSON.stringify(o.remote ?? { slot: "absent" })};`);
  if (o.alone === false) await context.addInitScript("Object.defineProperty(Screen.prototype, 'isExtended', { get: () => true });");
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-11-13T18:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-13T18:00:01Z"));
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => {
    if (!r.url().startsWith("file:")) external.push(r.url());
  });
  await page.goto(`file://${join(APP_DIR, "dist", "room.html")}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector(".room");
  await page.clock.runFor(50);
  return {
    page,
    errors,
    external,
    calls: () => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls),
    push: async (f) => {
      await page.evaluate((x) => {
        const w = window as unknown as { __frame: unknown; __push: (f: unknown) => void };
        w.__frame = x;
        w.__push(x);
      }, f);
      await page.clock.runFor(20);
    },
    pushRemote: async (v) => {
      await page.evaluate((x) => {
        const w = window as unknown as { __remote: unknown; __pushRemote: (v: unknown) => void };
        w.__remote = x;
        w.__pushRemote(x);
      }, v);
      await page.clock.runFor(20);
    },
    run: (ms) => page.clock.runFor(ms),
    phase: () => page.evaluate(() => document.querySelector<HTMLElement>(".band")?.dataset.phase ?? "none"),
    close: () => context.close(),
  };
}

/** Moves the pointer by more than the 6 px a nudged table makes: the band shows. */
export async function wiggle(page: Page, x = 400, y = 300): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.move(x + 20, y + 10);
}

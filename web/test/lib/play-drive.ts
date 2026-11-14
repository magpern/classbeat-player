// Helpers for what a person does on the web player page, on the fake site (play-fake.ts) with a paused
// clock: open a class, and read what is on the screen.
import { after, before } from "node:test";
import type { Browser, Page } from "playwright-core";
import { CLASS_ID, classScript, openPlay } from "./play-fake.ts";
import { BASE_DOC } from "./play-states.ts";
import { launchOffline } from "./site-fake.ts";
import type { FakeSite, Script } from "./site-fake.ts";

export interface OpenOptions {
  readonly script?: Script;
  readonly before?: string;
  readonly size?: readonly [number, number];
  readonly hash?: string;
}

/** Launches Chrome for the file's tests and returns `open`: a page on the fake site, by default on the base class. */
export function harness(): { readonly open: (o?: OpenOptions) => Promise<FakeSite>; readonly browser: () => Browser } {
  let browser: Browser;
  before(async () => {
    browser = await launchOffline();
  });
  after(async () => {
    await browser.close();
  });
  return {
    browser: () => browser,
    open: (o = {}) => openPlay(browser, { width: o.size?.[0] ?? 390, height: o.size?.[1] ?? 844, hash: o.hash ?? `#${CLASS_ID}`, script: o.script ?? classScript(BASE_DOC), before: o.before }),
  };
}

export const text = (page: Page, sel: string): Promise<string | null> => page.locator(sel).first().textContent();
export const link = (page: Page): Promise<string | null> => text(page, ".rail .link");
export const countdown = (page: Page): Promise<string> => page.locator(".count").first().evaluate((e) => e.textContent ?? "");
export const pill = async (page: Page): Promise<string | null> => ((await page.locator(".pill").count()) === 0 ? null : text(page, ".pill"));
/** The action of the main button: start, pause or resume. */
export const status = (page: Page): Promise<string> => page.locator("[data-action=start], [data-action=pause], [data-action=resume]").first().getAttribute("data-action") as Promise<string>;

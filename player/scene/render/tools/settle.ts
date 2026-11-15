// Makes a screenshot the same every time: the text layer's CSS transitions (the gel's colour cross,
// `--m-change`) run on the real clock, not on the harness's synthetic frame clock, so a shot taken right
// after the frames were played catches the gel part of the way. `settleTransitions` takes every running
// transition to its end, and says how many were still going afterwards (none, or the shot is not final).
import type { Page } from "playwright-core";

export async function settleTransitions(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  // `getAnimations` flushes pending style first, so a transition the last frame started is in the list; then one frame paints the end state.
  await page.evaluate(() => new Promise<void>((done) => {
    document.getAnimations().forEach((a) => a.finish());
    window.requestAnimationFrame(() => { document.getAnimations().forEach((a) => a.finish()); window.requestAnimationFrame(() => done()); });
  }));
  return page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
}

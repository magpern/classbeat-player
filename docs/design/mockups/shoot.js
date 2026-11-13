// Screenshots of every mock-up, at device scale 1, then the checks of measure.js on every shot
// (the kept ones and the worst cases at every size). Run from anywhere:
//   node docs/design/mockups/shoot.js
// Needs Playwright with Chromium. Writes the kept PNGs beside the HTML files; exits 1 if any
// mock-up makes an external request or any check fails.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { SHOTS } = require('./shots');
const { measure } = require('./measure');

(async () => {
  const browser = await chromium.launch();
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: s.motion || 'no-preference' });
    // No request leaves file://: the mock-ups must be self-contained.
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });
    await page.route(/^(?!file:)/, (r) => r.abort());
    await page.goto('file://' + path.join(__dirname, s.file));
    await page.evaluate(() => document.fonts.ready);
    // Animations stopped at their first frame, so a shot is the same on every run.
    if (s.save) await page.screenshot({ path: path.join(__dirname, s.png), animations: 'disabled' });
    await page.close();
    if (external.length) throw new Error(`${s.file}: external requests: ${external.join(', ')}`);
    if (s.save) console.log(s.png);
  }
  await browser.close();
  const failed = await measure(SHOTS);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

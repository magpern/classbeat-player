// Screenshots of every mock-up, at device scale 1. Run from anywhere:
//   node docs/design/mockups/shoot.js
// Needs Playwright with Chromium. Writes PNGs beside the HTML files.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { SHOTS } = require('./shots');

(async () => {
  const browser = await chromium.launch();
  for (const s of SHOTS) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
    // No request leaves file://: the mock-ups must be self-contained.
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith('file:')) external.push(r.url()); });
    await page.route(/^(?!file:)/, (r) => r.abort());
    await page.goto('file://' + path.join(__dirname, s.file));
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(__dirname, s.png);
    await page.screenshot({ path: out });
    await page.close();
    if (external.length) throw new Error(`${s.file}: external requests: ${external.join(', ')}`);
    console.log(s.png);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

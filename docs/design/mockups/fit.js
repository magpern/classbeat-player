// Website mock-ups are pages, not windows: they are shot and measured at their full height.
// fit(browser, shot) sets shot.h from the page at shot.w (shot.auto), once.
'use strict';
const path = require('path');

async function fit(browser, s) {
  if (!s.auto || s.h) return;
  const page = await browser.newPage({ viewport: { width: s.w, height: 800 } });
  await page.goto('file://' + path.join(__dirname, s.file));
  await page.evaluate(() => document.fonts.ready);
  s.h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.close();
}

module.exports = { fit };

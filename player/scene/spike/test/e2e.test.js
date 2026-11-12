'use strict';
// End-to-end: real Electron under Playwright. Needs a display (xvfb-run on headless Linux).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { launch, sleep } = require('../tools/launch');

const MAIN_NUMBERS = ['left', 'cadence', 'bpm', 'zone'];

test('room window: security defaults, text size, scene, recovery, fps log', { timeout: 90000 }, async () => {
  const { app, fpsLog, roomPage } = await launch({ size: '1280x720' });
  try {
    const room = await roomPage();
    await room.waitForFunction(() => window.__roomState && document.querySelector('canvas'), null, { timeout: 20000 });

    // Security defaults of both windows, read from the real webPreferences.
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
      const p = w.webContents.getLastWebPreferences();
      return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox };
    }));
    assert.equal(prefs.length, 2);
    for (const p of prefs) assert.deepEqual(p, { ci: true, ni: false, sb: true });
    assert.equal(await room.evaluate(() => typeof require), 'undefined');

    // Text height: every main number is at least 8 % of the window height, in the scene and in plain mode.
    const heights = async () => room.evaluate((ids) => ids.map((id) => document.getElementById(id).getBoundingClientRect().height / innerHeight), MAIN_NUMBERS);
    for (const h of await heights()) assert.ok(h >= 0.08, `text height ${h} < 8 %`);

    // Frame rate lines arrive in the log, one per second.
    await sleep(2500);
    assert.match(fs.readFileSync(fpsLog, 'utf8'), /fps mode=scene \d/);

    // Recovery: kill the scene renderer on purpose.
    const before = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    const t0 = Date.now();
    await app.evaluate(() => process.spikeTest.command({ type: 'kill-scene' }));
    await app.evaluate(async () => { for (let i = 0; i < 40 && process.spikeTest.state().recovery === null; i++) await new Promise((r) => setTimeout(r, 100)); });
    const wall = Date.now() - t0;
    const state = await app.evaluate(() => process.spikeTest.state());
    assert.equal(state.roomMode, 'plain');
    assert.ok(state.recovery && state.recovery.ok, JSON.stringify(state.recovery));
    assert.ok(state.recovery.latencyMs < 2000, `recovery took ${state.recovery.latencyMs} ms`);
    assert.ok(wall < 2500);

    // The clock is unaffected: it advanced by about the wall time, never reset or stalled.
    const after = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    assert.ok(Math.abs((after - before) - wall) < 400, `clock moved ${after - before} ms in ${wall} ms`);

    // Playwright marks the crashed page as dead, so inspect the reloaded room through the main process.
    const inRoom = (js) => app.evaluate(async (_e, code) => {
      const wc = process.spikeTest.getRoom().webContents;
      for (let i = 0; i < 50; i++) { if (!wc.isLoading() && await wc.executeJavaScript('!!window.__roomState')) break; await new Promise((r) => setTimeout(r, 100)); }
      return wc.executeJavaScript(code);
    }, js);
    assert.equal(await inRoom("document.body.classList.contains('plain')"), true);
    assert.equal(await inRoom("document.querySelectorAll('canvas').length"), 0);
    const ph = await inRoom(`${JSON.stringify(MAIN_NUMBERS)}.map((id) => document.getElementById(id).getBoundingClientRect().height / innerHeight)`);
    for (const h of ph) assert.ok(h >= 0.08, `plain text height ${h} < 8 %`);
    assert.match(await inRoom("document.getElementById('left').textContent"), /^\d+:\d\d$/);
  } finally {
    await app.close();
  }
});

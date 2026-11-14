'use strict';
// End-to-end, one-screen mode (one display, the studio's mirrored screen). Needs a display (xvfb-run).
// The controls are an overlay drawn on top of the full screen class view, never a window or panel
// of their own, except for godot-native where Godot's window is on top (a transparent overlay window).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launch, sleep, until } = require('../tools/launch');

const FAKE = path.join(__dirname, 'fake-godot.js');
const startOpts = (env = {}) => ({ size: '', env: { SPIKE_DISPLAY_MODE: 'one', ...env } });

// A real key press into whatever holds the keyboard in one-screen mode.
const press = (app, keyCode) => app.evaluate((_e, k) => {
  const wc = process.spikeTest.getController().webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: k });
  wc.sendInputEvent({ type: 'keyUp', keyCode: k });
}, keyCode);
const bandHidden = (app) => app.evaluate(() => process.spikeTest.getController().webContents.executeJavaScript("document.getElementById('band').classList.contains('hidden')"));
const untilBand = async (app, hidden, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await bandHidden(app)) === hidden) return; await sleep(100); }
  throw new Error(`band did not become ${hidden ? 'hidden' : 'visible'}`);
};

// Every window, the overlay window included, keeps the security defaults.
async function expectSecureWindows(app, count) {
  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
    const p = w.webContents.getLastWebPreferences();
    return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox };
  }));
  assert.equal(prefs.length, count);
  for (const p of prefs) assert.deepEqual(p, { ci: true, ni: false, sb: true });
}

async function expectFullScreenRoom(app) {
  for (let i = 0; i < 30; i++) { // the window manager settles the full screen asynchronously
    const same = await app.evaluate(({ screen }) => { const b = process.spikeTest.getRoom().getBounds(); const d = screen.getPrimaryDisplay().bounds; return Math.abs(b.width - d.width) <= 2 && Math.abs(b.height - d.height) <= 2; });
    if (same) break;
    await sleep(100);
  }
  const r = await app.evaluate(({ screen }) => {
    const t = process.spikeTest;
    return { one: t.isOneScreen(), b: t.getRoom().getBounds(), d: screen.getPrimaryDisplay().bounds };
  });
  assert.equal(r.one, true);
  // Xvfb has no window manager and reports the full screen window 1 px short; a real one is exact.
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(r.b[k] - r.d[k]) <= 2, `room ${k} ${r.b[k]} vs display ${r.d[k]}`);
}

// The view is never resized by the overlay: the overlay is fixed over the page, the text fills the window as before.
async function expectOverlayOnTop(room) {
  const r = await room.evaluate(() => {
    const b = document.getElementById('band').getBoundingClientRect();
    return { pos: getComputedStyle(document.getElementById('band')).position, bottom: b.bottom, h: innerHeight, left: document.getElementById('left').getBoundingClientRect().height / innerHeight, scrollH: document.documentElement.scrollHeight };
  });
  assert.equal(r.pos, 'fixed');
  assert.equal(r.bottom, r.h);
  assert.ok(r.left >= 0.08, 'main number still at least 8 % of the screen height');
  assert.ok(r.scrollH <= r.h, 'overlay adds no layout space');
}

test('one display, web variant: class view full screen, overlay on top, mouse and keys show it, keyboard works hidden', { timeout: 90000 }, async () => {
  const { app, roomPage } = await launch({ ...startOpts(), autostart: false });
  try {
    const room = await roomPage();
    await room.waitForFunction(() => window.__roomState && document.querySelector('canvas') && document.getElementById('band'), null, { timeout: 20000 });
    await expectFullScreenRoom(app);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'the room window only: no presenter, no panel');
    assert.equal(await app.evaluate(() => process.spikeTest.getOverlay()), null);
    await expectSecureWindows(app, 1);
    await expectOverlayOnTop(room);
    assert.ok(await room.evaluate(() => { const q = document.querySelector('#band button.quit'); return !!q && q.textContent.trim() === 'Quit'; }), 'a visible Quit');
    assert.equal(await room.evaluate(() => getComputedStyle(document.getElementById('band')).backgroundColor), 'rgb(0, 0, 0)', 'opaque panel');
    // Paused: the overlay shows its controls.
    assert.equal(await bandHidden(app), false);
    assert.ok(await room.evaluate(() => document.querySelectorAll('#band button[data-cmd]').length) >= 6);
    // The keyboard works: Space starts, Space pauses; a button works too.
    await press(app, 'Space');
    await until(app, 'process.spikeTest.clock.running() === true', 5000);
    await press(app, 'Space');
    await until(app, 'process.spikeTest.clock.running() === false', 5000);
    await room.click('#band button[data-cmd="toggle"]');
    await until(app, 'process.spikeTest.clock.running() === true', 5000);
    // Running: the overlay hides itself after a few seconds without movement ...
    await untilBand(app, true, 10000);
    // ... the keyboard still works with it hidden (C takes a screenshot) and shows it again ...
    await press(app, 'C');
    await until(app, 'process.spikeTest.state().lastCapture !== null', 8000);
    await untilBand(app, false, 5000);
    await untilBand(app, true, 10000);
    // ... and a mouse move shows it.
    await room.mouse.move(100, 100);
    await room.mouse.move(300, 300);
    await untilBand(app, false, 5000);
    await expectOverlayOnTop(room);
  } finally { await app.close(); }
});

test('one display: recovery within 2 s to a full screen plain 2D screen, overlay still there, clock unaffected', { timeout: 90000 }, async () => {
  const { app, roomPage } = await launch(startOpts());
  try {
    const room = await roomPage();
    await room.waitForFunction(() => window.__roomState && document.querySelector('canvas'), null, { timeout: 20000 });
    const before = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    const t0 = Date.now();
    await app.evaluate(() => process.spikeTest.command({ type: 'kill-scene' }));
    await until(app, 'process.spikeTest.state().recovery !== null', 8000);
    const wall = Date.now() - t0;
    const state = await app.evaluate(() => process.spikeTest.state());
    assert.equal(state.roomMode, 'plain');
    assert.ok(state.recovery.ok && state.recovery.latencyMs < 2000, JSON.stringify(state.recovery));
    await expectFullScreenRoom(app);
    const after = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    assert.ok(Math.abs((after - before) - wall) < 800, `clock moved ${after - before} ms in ${wall} ms`);
    // The reloaded plain screen has the overlay and the keyboard works on it.
    await app.evaluate(async () => { const wc = process.spikeTest.getRoom().webContents; for (let i = 0; i < 50; i++) { if (!wc.isLoading() && await wc.executeJavaScript("!!document.getElementById('band')")) break; await new Promise((r) => setTimeout(r, 100)); } });
    await press(app, 'Space');
    await until(app, `process.spikeTest.clock.running() === ${!state.running}`, 5000);
  } finally { await app.close(); }
});

test('one display, godot-native (fake): transparent overlay window above Godot holds the keyboard; killing Godot recovers to a full screen 2D screen', { timeout: 90000 }, async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-godot-')), 'states');
  const { app } = await launch({ ...startOpts({ SPIKE_GODOT_BIN: FAKE, FAKE_OUT: out }), variant: 'godot-native' });
  try {
    await until(app, 'process.spikeTest.getNative() && process.spikeTest.getNative().link.connected()', 20000);
    const o = await app.evaluate(({ screen }) => { const w = process.spikeTest.getOverlay(); return { top: w.isAlwaysOnTop(), b: w.getBounds(), d: screen.getPrimaryDisplay().bounds }; });
    assert.equal(o.top, true);
    await expectSecureWindows(app, 2); // the room (hidden) and the overlay window
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(o.b[k] - o.d[k]) <= 2, `overlay ${k} ${o.b[k]} vs display ${o.d[k]}`); // covers the display; transparent, so the view is not resized
    assert.equal(await app.evaluate(() => process.spikeTest.getRoom().isVisible()), false);
    // Shown again: the overlay window takes the keyboard back (a click through to Godot may have taken it).
    await app.evaluate(() => { const w = process.spikeTest.getOverlay(); w.__focused = 0; w.focus = () => { w.__focused++; }; w.isFocused = () => false; });
    await app.evaluate(() => process.spikeTest.getOverlay().webContents.executeJavaScript('window.spike.reportOverlay(true)'));
    await until(app, 'process.spikeTest.getOverlay().__focused >= 1', 5000);
    await press(app, 'Space'); // pauses the autostarted class
    await until(app, 'process.spikeTest.clock.running() === false', 5000);
    const t0 = Date.now();
    await app.evaluate(() => process.spikeTest.command({ type: 'kill-scene' }));
    await until(app, 'process.spikeTest.state().recovery !== null', 8000);
    assert.ok(Date.now() - t0 < 2500);
    const state = await app.evaluate(() => process.spikeTest.state());
    assert.ok(state.recovery.ok && state.recovery.latencyMs < 2000, JSON.stringify(state.recovery));
    await expectFullScreenRoom(app);
    assert.equal(await app.evaluate(() => process.spikeTest.getRoom().isVisible()), true);
    assert.equal(await app.evaluate(() => process.spikeTest.getOverlay()), null, 'the room page carries the overlay again');
  } finally { await app.close(); }
});

test('one display: the overlay Quit button quits the whole app, not only the overlay', { timeout: 60000 }, async () => {
  const { app, roomPage } = await launch({ ...startOpts(), autostart: false });
  const room = await roomPage();
  await room.waitForFunction(() => window.__roomState && document.getElementById('band'), null, { timeout: 20000 });
  const closed = new Promise((resolve) => app.process().once('exit', resolve));
  room.click('#band button.quit').catch(() => {}); // the page goes away under the click when the app quits
  await Promise.race([closed, sleep(10000).then(() => { throw new Error('app still running after Quit'); })]);
});

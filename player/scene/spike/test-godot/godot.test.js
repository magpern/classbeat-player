'use strict';
// Needs the real Godot editor and export templates (downloaded and checksum-verified by
// tools/godot.js), a display (xvfb-run) and software GL. NOT part of `npm test`; run it with
// `npm run godot:check`. Locally only: CI does not download Godot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { launch, sleep, until } = require('../tools/launch');
const godot = require('../tools/godot');
const { defaultBinary } = require('../harness/godot-native');

const MAIN = ['zone', 'left', 'cadence', 'bpm'];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('the project imports without script errors and exports headless for Linux, Windows, macOS and Web', { timeout: 600000 }, async () => {
  const imp = spawnSync(godot.editorBinary(), ['--headless', '--path', path.join(__dirname, '..', 'godot'), '--import'], { encoding: 'utf8' });
  assert.doesNotMatch(`${imp.stdout}${imp.stderr}`, /SCRIPT ERROR|Parse Error|Failed to load/);
  await godot.exportPresets(['linux', 'windows', 'macos', 'web']);
  for (const f of ['linux/classbeat-spike-scene.x86_64', 'windows/classbeat-spike-scene.exe', 'macos/classbeat-spike-scene.zip', 'web/index.html', 'web/index.js', 'web/index.wasm', 'web/index.pck']) {
    assert.ok(fs.statSync(path.join(__dirname, '..', 'godot', 'build', f)).size > 1000, f);
  }
  // The web export must be the single-threaded one (no SharedArrayBuffer, no special headers).
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'godot', 'build', 'web', 'index.html'), 'utf8'), /GODOT_THREADS_ENABLED = false;/);
});

test('native variant with the real Godot: link, text of at least 8 % of the height, fps, own PNG capture, recovery', { timeout: 180000 }, async () => {
  const { app, fpsLog, captureDir } = await launch({ size: '1280x720', variant: 'godot-native', startAt: 200, env: { SPIKE_GODOT_BIN: defaultBinary() } });
  try {
    await until(app, 'process.spikeTest.getNative() && process.spikeTest.getNative().link.connected()', 60000);
    await until(app, 'process.spikeTest.getTextH() !== null && Object.keys(process.spikeTest.getTextH()).length === 4', 30000);
    const textH = await app.evaluate(() => process.spikeTest.getTextH());
    for (const k of MAIN) assert.ok(textH[k] >= 0.08, `${k} ${textH[k]}`);
    await sleep(3000);
    assert.match(fs.readFileSync(fpsLog, 'utf8'), /fps mode=scene \d+\.\d/);
    await app.evaluate(() => process.spikeTest.command({ type: 'capture' }));
    await until(app, 'process.spikeTest.state().lastCapture', 15000);
    const png = fs.readFileSync(path.join(captureDir, await app.evaluate(() => process.spikeTest.state().lastCapture)));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 720]);
    // Recovery with the real program: kill it, the plain screen follows within 2 s, the clock goes on.
    const pid = await app.evaluate(() => process.spikeTest.getNative().child.pid);
    const before = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    const t0 = Date.now();
    await app.evaluate(() => process.spikeTest.command({ type: 'kill-scene' }));
    await until(app, 'process.spikeTest.state().recovery !== null', 5000);
    const wall = Date.now() - t0;
    const st = await app.evaluate(() => process.spikeTest.state());
    assert.ok(st.recovery.ok && st.recovery.latencyMs < 2000, JSON.stringify(st.recovery));
    assert.equal(st.roomMode, 'plain');
    assert.equal(alive(pid), false);
    const after = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    assert.ok(Math.abs((after - before) - wall) < 800);
  } finally { await app.close(); }
});

test('web variant of Godot in the room window: Godot draws the scene, HTML text over it, fps from Godot, recovery', { timeout: 180000 }, async () => {
  const { app, fpsLog, roomPage } = await launch({ size: '1280x720', variant: 'godot-web', startAt: 200 });
  try {
    const room = await roomPage();
    await room.waitForFunction(() => window.__roomState && document.querySelector('canvas'), null, { timeout: 30000 });
    for (let i = 0; i < 600 && !fs.readFileSync(fpsLog, 'utf8').includes('fps mode=scene'); i++) await sleep(100); // only Godot reports fps here
    for (const id of MAIN) assert.ok(await room.evaluate((i) => document.getElementById(i).getBoundingClientRect().height / innerHeight, id) >= 0.08, id);
    assert.match(await room.evaluate(() => document.getElementById('zone').textContent), /^ZONE \d [A-Z]+$/);
    assert.match(fs.readFileSync(fpsLog, 'utf8'), /fps mode=scene \d+\.\d/);
    // Same rule as the web variant: kill the renderer, plain screen within 2 s.
    await app.evaluate(() => process.spikeTest.command({ type: 'kill-scene' }));
    await until(app, 'process.spikeTest.state().recovery !== null', 6000);
    const st = await app.evaluate(() => process.spikeTest.state());
    assert.ok(st.recovery.ok && st.recovery.latencyMs < 2000, JSON.stringify(st.recovery));
    assert.equal(st.roomMode, 'plain');
  } finally { await app.close(); }
});

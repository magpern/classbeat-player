'use strict';
// End-to-end, native Godot variant, with a fake Godot program (test/fake-godot.js): the same link,
// recovery and window handling as with the real one, no GPU needed. Needs a display (xvfb-run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, sleep, until } = require('../tools/launch');

const FAKE = path.join(__dirname, 'fake-godot.js');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function start(env) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-godot-')), 'states');
  const h = await launch({ size: '1280x720', variant: 'godot-native', env: { SPIKE_GODOT_BIN: FAKE, FAKE_OUT: out, ...env } });
  await until(h.app, 'process.spikeTest.getNative() && process.spikeTest.getNative().link.connected()', 20000);
  return { ...h, out };
}

// The shell's view after recovery: plain screen visible in the room window, clock unaffected.
async function expectPlainScreen(app, clockBefore, wallStart) {
  await until(app, 'process.spikeTest.state().recovery !== null', 8000);
  const wall = Date.now() - wallStart;
  const state = await app.evaluate(() => process.spikeTest.state());
  assert.ok(state.recovery.ok, JSON.stringify(state.recovery));
  assert.ok(state.recovery.latencyMs < 2000, `plain screen took ${state.recovery.latencyMs} ms`);
  assert.equal(state.roomMode, 'plain');
  assert.equal(await app.evaluate(() => process.spikeTest.getNative()), null);
  assert.equal(await app.evaluate(() => process.spikeTest.getRoom().isVisible()), true);
  const inRoom = (js) => app.evaluate((_e, code) => process.spikeTest.getRoom().webContents.executeJavaScript(code), js);
  assert.equal(await inRoom("document.body.classList.contains('plain') && document.querySelectorAll('canvas').length === 0"), true);
  for (const id of ['left', 'cadence', 'bpm', 'zone']) assert.ok(await inRoom(`document.getElementById('${id}').getBoundingClientRect().height / innerHeight`) >= 0.08, id);
  const after = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
  assert.ok(Math.abs((after - clockBefore) - wall) < 800, `clock moved ${after - clockBefore} ms in ${wall} ms`);
  return state;
}

test('move-room to the room\'s current display keeps the same Godot process, and keeps the room window hidden', { timeout: 60000 }, async () => {
  const { app } = await start({});
  try {
    const pid = await app.evaluate(() => process.spikeTest.getNative().child.pid);
    const bounds = await app.evaluate(() => process.spikeTest.getNativeBounds());
    assert.ok(bounds, 'the launch display is known as soon as Godot is started');
    await app.evaluate(() => process.spikeTest.command({ type: 'move-room', n: 1 }));
    await sleep(500);
    assert.equal(await app.evaluate(() => process.spikeTest.getNative().child.pid), pid, 'same process');
    assert.deepEqual(await app.evaluate(() => process.spikeTest.getNativeBounds()), bounds);
    assert.equal(alive(pid), true);
    assert.equal(await app.evaluate(() => process.spikeTest.getRoom().isVisible()), false);
  } finally { await app.close(); }
});

test('Godot killed: the room window shows the plain 2D screen within 2 s, clock continuous', { timeout: 60000 }, async () => {
  const { app } = await start({});
  try {
    assert.equal(await app.evaluate(() => process.spikeTest.getRoom().isVisible()), false, 'room window is hidden while Godot has the screen');
    const pid = await app.evaluate(() => process.spikeTest.getNative().child.pid);
    const before = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    const t0 = Date.now();
    await app.evaluate(() => process.spikeTest.command({ type: 'kill-scene' }));
    await expectPlainScreen(app, before, t0);
    assert.equal(alive(pid), false);
  } finally { await app.close(); }
});

test('Godot goes silent (alive but not answering): after 2 s of silence the plain screen, and Godot is killed', { timeout: 60000 }, async () => {
  const { app } = await start({ FAKE_MODE: 'silent', FAKE_AFTER_MS: '1500' });
  try {
    const pid = await app.evaluate(() => process.spikeTest.getNative().child.pid);
    const before = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    const t0 = Date.now();
    await expectPlainScreen(app, before, t0);
    const wall = Date.now() - t0;
    assert.ok(wall >= 2800, `reported dead after only ${wall} ms: silence must last 2 s`);
    assert.ok(wall < 6000, `took ${wall} ms`);
    await sleep(300);
    assert.equal(alive(pid), false, 'the silent Godot process is killed');
  } finally { await app.close(); }
});

test('Godot dies by itself: plain screen at once', { timeout: 60000 }, async () => {
  const { app } = await start({ FAKE_MODE: 'die', FAKE_AFTER_MS: '1000' });
  try {
    const before = await app.evaluate(() => process.spikeTest.clock.elapsedMs());
    await expectPlainScreen(app, before, Date.now());
  } finally { await app.close(); }
});

test('healthy: state reaches Godot, fps and text sizes are logged, capture works, variant switch stops Godot', { timeout: 60000 }, async () => {
  const { app, fpsLog, out } = await start({});
  try {
    await sleep(2500);
    assert.ok(Number(fs.readFileSync(out, 'utf8')) >= 15, 'state is sent about 10 times a second');
    assert.match(fs.readFileSync(fpsLog, 'utf8'), /fps mode=scene 60\.0/);
    assert.deepEqual(await app.evaluate(() => process.spikeTest.getTextH()), { zone: 0.12, left: 0.3, cadence: 0.14, bpm: 0.14 });
    await app.evaluate(() => process.spikeTest.command({ type: 'capture' }));
    await until(app, "process.spikeTest.state().lastCapture === 'fake.png'", 5000);
    const pid = await app.evaluate(() => process.spikeTest.getNative().child.pid);
    await app.evaluate(() => process.spikeTest.command({ type: 'variant', variant: 'web' }));
    await until(app, "process.spikeTest.state().variant === 'web' && process.spikeTest.getRoom().isVisible()", 5000);
    assert.equal(await app.evaluate(() => process.spikeTest.getNative()), null);
    await sleep(300);
    assert.equal(alive(pid), false);
    // No recovery was recorded: leaving Godot on purpose is not a failure.
    assert.equal((await app.evaluate(() => process.spikeTest.state())).recovery, null);
  } finally { await app.close(); }
});

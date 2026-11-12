'use strict';
// Launches the harness under Playwright's Electron support. The headless-only Chromium flags
// (no sandbox, software GL) are passed HERE, never set in the app's own windows.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

// `env` adds or overrides environment variables for the harness (for example SPIKE_GODOT_BIN).
async function launch({ size = '1920x1080', variant = 'web', startAt = 0, env = {}, autostart = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike2-'));
  const fpsLog = path.join(dir, 'fps.log');
  const captureDir = path.join(dir, 'captures');
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', ...(process.env.SPIKE_GLFLAGS ? process.env.SPIKE_GLFLAGS.split(' ') : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      '--ignore-gpu-blocklist', '--user-data-dir=' + path.join(dir, 'ud'), path.join(__dirname, '..', 'harness', 'main.js')],
    env: {
      ...process.env, SPIKE_TEST: '1', SPIKE_ROOM_SIZE: size, SPIKE_VARIANT: variant, SPIKE_FPS_LOG: fpsLog, SPIKE_CAPTURE_DIR: captureDir,
      ...(autostart ? { SPIKE_AUTOSTART: '1' } : {}), ...(startAt ? { SPIKE_START_AT_S: String(startAt) } : {}), ...env,
    },
  });
  const roomPage = async () => {
    for (let i = 0; i < 100; i++) {
      const p = app.windows().find((w) => w.url().includes('room.html'));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('room window not found');
  };
  return { app, fpsLog, captureDir, roomPage };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits (polling in the main process) until `cond` (a string of JS run there) is truthy.
async function until(app, cond, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await app.evaluate((_e, c) => (0, eval)(c), cond)) return true; // eslint-disable-line no-eval
    await sleep(100);
  }
  throw new Error(`timed out waiting for: ${cond}`);
}

module.exports = { launch, sleep, until };

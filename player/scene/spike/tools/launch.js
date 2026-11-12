'use strict';
// Launches the harness under Playwright's Electron support. The headless-only Chromium flags
// (no sandbox, software GL) are passed HERE, never set in the app's own windows.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

async function launch({ size = '1920x1080', variant = 'web', startAt = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike2-'));
  const fpsLog = path.join(dir, 'fps.log');
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', ...(process.env.SPIKE_GLFLAGS ? process.env.SPIKE_GLFLAGS.split(' ') : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      '--ignore-gpu-blocklist', '--user-data-dir=' + path.join(dir, 'ud'), path.join(__dirname, '..', 'harness', 'main.js')],
    env: { ...process.env, SPIKE_TEST: '1', SPIKE_ROOM_SIZE: size, SPIKE_VARIANT: variant, SPIKE_FPS_LOG: fpsLog, SPIKE_AUTOSTART: '1', ...(startAt ? { SPIKE_START_AT_S: String(startAt) } : {}) },
  });
  const roomPage = async () => {
    for (let i = 0; i < 100; i++) {
      const p = app.windows().find((w) => w.url().includes('room.html'));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('room window not found');
  };
  return { app, fpsLog, roomPage };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { launch, sleep };

'use strict';
// Headless screenshots of the room, at 1920x1080 and 1280x720.
//   npm run screenshots           web variant: scene and plain 2D screen  -> room-<mode>-<size>.png
//   npm run screenshots:godot     godot-web and godot-native scenes       -> <variant>-scene-<size>.png
// (the Godot ones need `npm run godot:export` first). Writes PNGs to ../screenshots/.
// godot-native uses Godot's own viewport capture; the other variants capture the room window.
const fs = require('node:fs');
const path = require('node:path');
const { launch, sleep, until } = require('./launch');

const OUT = path.join(__dirname, '..', 'screenshots');
const NATIVE_BIN = require('../harness/godot-native').defaultBinary();

async function shotNative(size, startAt) {
  const { app, captureDir } = await launch({ size, variant: 'godot-native', startAt, env: { SPIKE_GODOT_BIN: process.env.SPIKE_GODOT_BIN || NATIVE_BIN } });
  try {
    await until(app, 'process.spikeTest.getNative() && process.spikeTest.getNative().link.connected()', 60000);
    await until(app, 'process.spikeTest.getTextH() !== null', 30000);
    await sleep(2500);
    await app.evaluate(() => process.spikeTest.command({ type: 'capture' }));
    await until(app, 'process.spikeTest.state().lastCapture', 15000);
    const name = await app.evaluate(() => process.spikeTest.state().lastCapture);
    const file = path.join(OUT, `godot-native-scene-${size}.png`);
    fs.copyFileSync(path.join(captureDir, name), file);
    console.log('wrote', path.relative(process.cwd(), file));
  } finally {
    await app.close();
  }
}

async function shotRoom(variant, size, mode, startAt) {
  const { app, roomPage } = await launch({ size, variant, startAt });
  try {
    const room = await roomPage();
    await room.waitForFunction(() => window.__roomState && document.querySelector('canvas'), null, { timeout: 20000 });
    if (mode === 'plain') await app.evaluate(() => process.spikeTest.command({ type: 'mode', mode: 'plain' }));
    // Capture only painted content: page loaded in the wanted mode, zone text filled, then two frames.
    await app.evaluate(async (_e, wantPlain) => {
      const wc = process.spikeTest.getRoom().webContents;
      const ready = `(${wantPlain} === document.body.classList.contains('plain')) && !!window.__roomState
        && document.getElementById('zone').textContent.length > 0 && (${wantPlain} || !!document.querySelector('canvas'))`;
      for (let i = 0; i < 100; i++) {
        if (!wc.isLoading() && await wc.executeJavaScript(ready)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    }, mode === 'plain');
    if (mode === 'scene') await sleep(variant === 'godot-web' ? 8000 : 1500); // the Godot web engine loads first
    const b64 = await app.evaluate(async () => (await process.spikeTest.getRoom().webContents.capturePage()).toPNG().toString('base64'));
    const file = path.join(OUT, `${variant === 'web' ? 'room' : variant}-${mode}-${size}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('wrote', path.relative(process.cwd(), file));
  } finally {
    await app.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const variants = (process.argv.find((a) => a.startsWith('--variants=')) || '--variants=web').slice('--variants='.length).split(',');
  for (const size of ['1920x1080', '1280x720']) {
    for (const v of variants) {
      if (v === 'godot-native') await shotNative(size, 200); // inside "Push", zone 4
      else {
        await shotRoom(v, size, 'scene', 200);
        if (v === 'web') await shotRoom(v, size, 'plain', 200);
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });

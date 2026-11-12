'use strict';
// Headless screenshots of the room window: scene and plain 2D, at 1920x1080 and 1280x720.
// Run: npm run screenshots  (xvfb-run on headless Linux). Writes PNGs to ../screenshots/.
const fs = require('node:fs');
const path = require('node:path');
const { launch, sleep } = require('./launch');

const OUT = path.join(__dirname, '..', 'screenshots');

async function shot(size, mode, startAt) {
  const { app, roomPage } = await launch({ size, startAt });
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
    if (mode === 'scene') await sleep(1500);
    const b64 = await app.evaluate(async () => (await process.spikeTest.getRoom().webContents.capturePage()).toPNG().toString('base64'));
    const file = path.join(OUT, `room-${mode}-${size}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('wrote', path.relative(process.cwd(), file));
  } finally {
    await app.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const size of ['1920x1080', '1280x720']) {
    await shot(size, 'scene', 200); // inside "Push", zone 4
    await shot(size, 'plain', 200);
  }
})().catch((e) => { console.error(e); process.exit(1); });

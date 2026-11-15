# Scene renderer (PL6, ADR 0009)

The room scene drawn with three.js, to `docs/design/scene.md`. It only draws what the pure scene
model (`../model`) says: `RigLoop.step` calls the model's `stepRig` (frame-time clamp to 100 ms, motion
phase, `sceneFrame`, the turn-rate limiter `limitTurn`), and `SceneRig.apply` sets each beam to the
model's drawn direction.

| Module | What |
|---|---|
| `src/loop.ts`, `src/bursts.ts`, `src/light-calc.ts`, `src/tokens.ts` | Pure: the per-frame loop, bursts and the song-change dim, brightness calculations, tokens reader. No three.js, no DOM, no clock |
| `src/aim.ts`, `src/fixtures.ts`, `src/wall.ts`, `src/haze.ts`, `src/rig.ts` | The three.js scene graph (no WebGL): 22 fixtures, the wall, haze, the burst plane, the fixed camera |
| `src/renderer.ts` | `SceneRenderer`: the canvas, the animation frame, the quality level's render scale |
| `demo/`, `tools/` | The demo page, the Node and browser frame logs, the screenshots |

Mounting: `new SceneRenderer(canvas, { tokens: readSceneTokens(getComputedStyle(root)) })`, then
`start(() => feed)`, where the feed is the class clock's state (`Feed` in `src/loop.ts`). The page
must load the screens lane's `tokens.css` (zone colours and `--light-1` are read from it, never kept
here). `readSceneTokens(...).missing` names the scene tokens `tokens.css` does not hold yet.

```bash
npm ci
npm test            # lint, types, unit tests (incl. the Node frame log), then the browser run
npm run test:unit   # no browser: the drive, rule and gate tests
npm run test:shots  # builds dist/, then screenshots/ and artifacts/frame-log-browser.csv in headless Chrome
```

`artifacts/frame-log.csv` (Node) and `artifacts/frame-log-browser.csv` hold the highest beam speed of
each second; the runs fail above 30 degrees a second plus 2 percent.

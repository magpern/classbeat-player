# Scene renderer (PL6, ADR 0009)

The room scene drawn with three.js, to `docs/design/scene.md`. It only draws what the pure scene
model (`../model`) says: `RigLoop.step` calls the model's `stepRig` (frame-time clamp to 100 ms, motion
phase, `sceneFrame`, the turn-rate limiter `limitTurn`), and `SceneRig.apply` sets each beam to the
model's drawn direction.

| Module | What |
|---|---|
| `src/loop.ts`, `src/bursts.ts`, `src/light-calc.ts`, `src/tokens.ts` | Pure: the per-frame loop, bursts and the song-change dim, brightness calculations, tokens reader. No three.js, no DOM, no clock |
| `src/aim.ts`, `src/fixtures.ts`, `src/wall.ts`, `src/haze.ts`, `src/rig.ts` | The three.js scene graph (no WebGL): 22 fixtures, the wall, haze, the burst plane, the fixed camera |
| `src/text-*-calc.ts`, `src/text-words.ts`, `src/text-view.ts`, `src/text-types.ts` | Pure: the text layer's rules. `textView` turns the class, the class clock and the link into every string and size class of the nine content items (S4); the pattern count (S14), the score (S3, S13), the fitting rules (S15, S16) and the dark-under-text mask's numbers (S2) |
| `src/text-mask.ts` | The dark-under-text mask: a quad per text line, drawn last, writing the lower of the scene and the cap level (S2) |
| `layer/` | The text layer's DOM, the only place that builds nodes (a `div` or a `span` by text, class and style), fenced by its own lint block; `text.css` places them in shares of the window and names no colour of its own |
| `src/renderer.ts` | `SceneRenderer`: the canvas, the animation frame, the quality level's render scale |
| `demo/`, `tools/` | The demo page, the Node and browser frame logs, the screenshots |

Mounting: `new SceneRenderer(canvas, { tokens: readSceneTokens(getComputedStyle(root)) })`, then
`start(() => feed)`, where the feed is the class clock's state (`Feed` in `src/loop.ts`). The page
must load the screens lane's `tokens.css` (zone colours and `--light-1` are read from it, never kept
here). `readSceneTokens(...).missing` names the scene tokens `tokens.css` does not hold yet.

The text layer: the shell gives `textView` a `TextInput` (the class in the room window's words, `src/text-types.ts`),
passes the view to `TextLayer.update`, and hands `TextLayer.boxes()` to `SceneRenderer.setTextBoxes`, so the light under
every line of text is held to `--scene-text-cap`. The page loads `layer/text.css` after `tokens.css`. Demo parameters:
`class=long` (sixteen minutes with real lengths), `class=worst` (the worst case of "Fitting"), `mask=0` (the scene
without the mask), `text=0` (the scene without text).

```bash
npm ci
npm test            # lint, types, unit tests (incl. the Node frame log), then the browser run
npm run test:unit   # no browser: the drive, rule and gate tests
npm run test:shots  # builds dist/, then screenshots/ and artifacts/frame-log-browser.csv in headless Chrome
```

The browser run also checks the text layer on the real page, for each zone at 16:9, 16:10 and 4:3 and for the worst
case in each link state (`tools/text-shots.ts`): cap heights (S1), the colour of every line (S2, S12), the safe area
(S15), overlaps and cut-off text (S16), and the light under the text over 120 frames and more in zones 4 and 7 with
the mask and without it (S2). Screenshots: `screenshots/text-*.png`.

`artifacts/frame-log.csv` (Node) and `artifacts/frame-log-browser.csv` hold the highest beam speed of
each second; the runs fail above 30 degrees a second plus 2 percent.

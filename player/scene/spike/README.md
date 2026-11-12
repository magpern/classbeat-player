# Spike 2 harness (throwaway)

Plan section 9. A minimal Electron shell to judge how a scene technology behaves in a real
studio set-up. **Deleted after spike 2.** Nothing here is product code, and a user never sees it.

- `harness/` is shared by every scene variant: main process (owns the fake class clock), presenter
  window, room window (large HTML text over the scene), plain 2D screen, recovery rule, fps log.
- `web/` is the three.js light-show scene. A Godot variant is added later beside it
  (`SPIKE_VARIANT=godot`, loaded by `harness/room.js`).
- Fake class: 10 minutes, 7 intervals, zones 1 to 5, cadence and BPM (`harness/class-def.js`).
- No network (non-`file://` requests are cancelled), no audio, no Spotify. Windows use
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Run it on a studio computer (owner)

Needs Node 22 or newer and a second display (a projector counts).

```bash
cd player/scene/spike
npm ci
npm start
```

Two windows open: the **presenter** (keep it on the computer's own screen, it holds the keyboard)
and the **room** window. With a second display the room window goes full screen on it; with one
display it is a 1280x720 window.

Presenter keys: `Space` start/pause, `R` reset, `K` kill the scene renderer on purpose,
`P` plain 2D screen, `S` scene, `1`-`9` move the room screen to display N (the list is on the
presenter window).

The frame rate is logged once a second to `fps.log` in the app's user-data folder
(Windows: `%APPDATA%\classbeat-player-spike2\fps.log`; or set `SPIKE_FPS_LOG=<file>`). Recovery
times are logged there too.

### Checklist (plan section 9) and what to hand back

1. **Look and frame rate:** let it run a few minutes at full screen. Hand back `fps.log` and a
   photo or screenshot, plus the computer's model, CPU, graphics and Windows version.
2. **Full screen on the second display** while the presenter keeps the keyboard: does `Space`
   still work, does the room window stay on top without stealing focus?
3. **Text readable at room distance**, and still right after a **resize**, **unplugging** the
   display and **plugging it in again** (the room window should come back to a display by itself).
4. **Recovery:** press `K`. The room screen must show the plain 2D screen within 2 seconds, and
   the presenter's clock must not jump or stop. Note the time shown on the presenter
   ("last recovery: ok in N ms").
5. Anything odd: flicker, tearing, the window on the wrong display, a slow start.

## Tests and screenshots (agents, CI later)

```bash
npm ci
npm run test:headless      # unit tests (clock, recovery rule) and an end-to-end run
npm run screenshots        # writes PNGs to screenshots/ (1920x1080 and 1280x720, scene and plain)
```

On a machine with a display, `npm test` is enough. Headless Linux needs `xvfb-run` (the scripts
above use it). The launcher (`tools/launch.js`) passes `--no-sandbox` and software GL flags to
Electron for the headless run only; the app's own windows never set them.

The end-to-end test checks: the security defaults of both windows, every main number at least
8 % of the window height (scene and plain), the fps log, and recovery (scene killed, plain
screen within 2 s, clock continuous).

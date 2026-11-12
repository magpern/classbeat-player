# Spike 2 harness (throwaway)

Plan section 9. A minimal Electron shell to judge how a scene technology behaves in a real
studio set-up. **Deleted after spike 2.** Nothing here is product code, and a user never sees it.

Three variants of the same rough light-show scene, run in the same shell:

| Variant | Who draws what | Folder |
|---|---|---|
| `web` | three.js scene in the room window, HTML text over it | `web/` |
| `godot-native` | Godot 4 as its own program, started by the shell, full screen on the chosen display; **Godot draws the scene and the text** from the clock state the shell sends over a local WebSocket | `godot/` (project), `harness/godot-*.js` |
| `godot-web` | Godot 4's web export in the room window (same scene, no text of its own), HTML text over it, as in `web` | `godot/` (project), `godot-web/` |

- `harness/` is shared by every variant: main process (owns the fake class clock), presenter
  window, room window (large HTML text over the scene), plain 2D screen, recovery rule, fps log.
- `godot/` is the Godot 4.7.2 project (text scene files, GL Compatibility renderer, dummy audio
  driver) with export presets for Linux, Windows, macOS and Web. Built files, the editor and the
  export templates are never committed (`godot/.gitignore`).
- Fake class: 10 minutes, 7 intervals, zones 1 to 5, cadence and BPM (`harness/class-def.js`).
- No network beyond 127.0.0.1, no audio, no Spotify. Windows use `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`. Only the presenter window may send commands; a
  command from the room window is refused (tested).

### How the native variant is joined (security)

- The shell opens a WebSocket server on **127.0.0.1 only**, random port, and starts Godot with the
  port and a random per-launch token in its **environment** (`SPIKE_LINK_PORT`, `SPIKE_LINK_TOKEN`),
  never on the command line or in a URL. Godot sends the token in an `Authorization: Bearer` header.
  The server accepts one client, and refuses a wrong or missing token and any request with an
  `Origin` header (a web page).
- The shell sends the clock state about 10 times a second. Godot sends a heartbeat every 0.5 s
  (with the sizes of its main numbers), its frame rate every second, and a PNG capture on request.
- **Recovery:** the shell's room window stays hidden while Godot owns the screen, with the plain 2D
  screen already loaded. When the Godot process exits, or says nothing for 2 s (it is then killed),
  the room window is shown on that display with the plain 2D screen. The class clock lives in the
  main process and is unaffected. Before its first message Godot gets 15 s to start.
- Focus: Godot's window is `unfocusable`, and the shell focuses the presenter after launching, so the
  presenter keeps the keyboard. If the room's display changes, Godot is started again on the new one.
- `godot-web` is served to the room window by the shell under a private `godotweb://app/` scheme
  from `godot/build/web` (exact file names, an allowlist of extensions); no port is opened. The room
  page's CSP allows that scheme and `wasm-unsafe-eval`.

## Run it on a studio computer (owner)

Needs Node 22 or newer, a second display (a projector counts), and, for the Godot variants, the
exported builds (agents can hand you a zip, or run `npm run godot:setup && npm run godot:export`
once: it downloads the pinned Godot editor and export templates, about 1.3 GB, and checks their
SHA-512 against `godot/version.json`).

```bash
cd player/scene/spike
npm ci
npm run godot:export     # once, on the studio computer or elsewhere; builds under godot/build/
npm start                # variant web
npm start -- --variant=godot-native     # or godot-web
```

`SPIKE_VARIANT=<variant>` works too. Two windows open: the **presenter** (keep it on the computer's
own screen, it holds the keyboard) and the **room** window. With a second display the room goes full
screen on it; with one display it is a 1280x720 window. For `godot-native` the Godot window plays that
role and the room window stays hidden until a recovery.

Presenter keys: `Space` start/pause, `R` reset, `K` kill the scene (the renderer, or the Godot
process), `P` plain 2D screen, `S` scene, `V` next variant (or click the variant buttons: you can
compare all three in one run without restarting), `C` screenshot, `1`-`9` move the room screen to
display N (the list is on the presenter window).

The frame rate is logged once a second to `fps.log` in the app's user-data folder
(Windows: `%APPDATA%\classbeat-player-spike2\fps.log`; or set `SPIKE_FPS_LOG=<file>`), with the
variant at start and every switch. Recovery times are logged there too. Screenshots (`C`) go to
`captures/` next to it (`SPIKE_CAPTURE_DIR`); the native variant's are Godot's own viewport capture.

### Owner's comparison run (all three variants, same studio computer)

Run each variant for the same few minutes with the same display set-up and fill the checklist for it.
Start with `web`, then press `V` for `godot-native`, then `godot-web`; or start each one with its launch
option for a clean fps log.

### Checklist (plan section 9), per variant

1. **Look and frame rate:** let it run a few minutes at full screen. Note `fps.log` lines for the
   variant, and a photo or screenshot (`C`).
2. **Full screen on the second display** while the presenter keeps the keyboard: does `Space`
   still work, does the room stay on top without stealing focus? (Native: does Godot's window take
   the keyboard when it starts? Does it cover the taskbar or flicker?)
3. **Text readable at room distance**, and still right after a **resize**, **unplugging** the
   display and **plugging it in again** (the room window, or the Godot window, should come back to a
   display by itself).
4. **Recovery:** press `K`. The room screen must show the plain 2D screen within 2 seconds, and
   the presenter's clock must not jump or stop. Note "last recovery: ok in N ms" on the presenter.
   For `godot-native` also try ending the Godot process in the task manager, and (if you can)
   freezing it. Native text and zone: is the zone a number and a name as well as a colour?
5. **Start-up:** seconds from start to first frame, per variant; Godot native and web also load their
   engine first.
   With more than one display, `1`-`9` must also move the Godot window (native Godot is started again on
   the chosen display), and the hidden room window must never appear over Godot while it runs (the shell
   does not call full screen on it while it is hidden). The restart rule and "same display keeps the same process" are tested; a real second display is not testable headless: check it here.
6. Anything odd: flicker, tearing, the window on the wrong display, a slow start, antivirus or
   firewall prompts (the native variant opens a loopback socket and starts a second program).

### What to hand back

- `fps.log` (all three variants), screenshots, and a photo of the room if possible.
- The computer's model, CPU, graphics and Windows version.
- Per variant: the checklist answers above, and which one you would build on and why.

## What agents verified headless (and what only a studio computer can)

| | Headless Linux (xvfb, software GL) | Needs a real studio computer |
|---|---|---|
| Godot project imports, exports for Linux, Windows, macOS and Web | yes (`npm run godot:check`) | running the Windows and macOS builds |
| Native: link, token, text height of the main numbers, fps, Godot's PNG capture, recovery (kill) | yes, with the real Godot | real GPU frame rate, focus and full screen on a second display, display unplug |
| Web in the room window: scene drawn by Godot, HTML text, fps from Godot, recovery | yes | real GPU frame rate and Godot's web engine on the studio's Chromium |
| Silent or dying Godot, with a fake program | yes (`npm test`) | a really frozen Godot |
| Screenshots | all variants, 1920x1080 and 1280x720 | the look on the projector |

Frame rates measured headless are software-rendered and mean nothing for a studio computer.

## Tests and screenshots (agents)

```bash
npm ci
npm run test:headless      # `npm test` under xvfb: unit tests and end-to-end runs (this is what CI runs)
npm run screenshots        # web variant, scene and plain 2D, 1920x1080 and 1280x720
npm run godot:check        # needs the pinned Godot (npm run godot:setup): imports, exports for all four
                           # presets, and drives the real native and web Godot variants. Local only.
npm run screenshots:godot  # godot-web and godot-native, after the exports
```

`npm test` needs no Godot: the native variant is tested with a fake program (`test/fake-godot.js`)
that speaks the same link, and with a fake child process for the recovery rule. `npm run godot:check`
is kept out of `npm test` because CI does not download Godot (1.3 GB) and software-rendered Godot is
slow. On a machine with a display `npm test` alone is enough; headless Linux needs `xvfb-run`.
The launcher (`tools/launch.js`) passes `--no-sandbox` and software GL flags to Electron for the
headless run only; the app's own windows never set them. Behind a proxy run the downloader with
`NODE_USE_ENV_PROXY=1`.

The end-to-end tests check: the security defaults of both windows, a command from the room window is
refused, every main number at least 8 % of the window height (scene and plain), the fps log, and
recovery (scene killed, plain screen within 2 s, clock continuous) for the web and native variants,
including a Godot that goes silent.

Not covered by the spike recovery: a hung renderer (unresponsive) or a lost WebGL context does not
fall back in the web variants; only a renderer crash does (a silent native Godot does, after 2 s).
Note it for the real shell (PL4, PL5). Electron is pinned to the newest 44.x and npm audit is clean;
bump it when the spike is run later.

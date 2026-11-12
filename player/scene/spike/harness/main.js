'use strict';
// Spike 2 harness main process. Owns the fake class clock, so a dead scene renderer
// cannot touch it. Presenter window + room window. No network, no audio.
const { app, BrowserWindow, ipcMain, protocol, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createClock } = require('./clock');
const { CLASS_DEF, ZONES } = require('./class-def');
const { createRecovery } = require('./recovery');
const { parseCommand } = require('./commands');
const { VARIANTS, parseVariant } = require('./variant');
const { needsRestart } = require('./native-display');
const { launchNative, buildArgs, defaultBinary } = require('./godot-native');
const godotWeb = require('./godot-web');

let VARIANT = parseVariant(process.env, process.argv);
godotWeb.registerScheme(protocol); // must happen before the app is ready
const TEST = process.env.SPIKE_TEST === '1';
const ROOM_SIZE = (process.env.SPIKE_ROOM_SIZE || '').split('x').map(Number); // windowed size for tests
const clock = createClock(CLASS_DEF, () => performance.now()); // monotonic: immune to system clock steps
let presenter = null;
let room = null;
let roomMode = 'scene';
let roomDisplayId = null;
let lastRecovery = null;
let fpsLog = null;
let nativeBounds = null; // where Godot runs or is being launched (set at launch, so a key pressed while it starts counts)
let native = null; // the running Godot program (variant godot-native): { send, stop, bounds, child }
let nativeGen = 0; // bumped on every start and stop, so a late event from an old launch is ignored
let captureDir = null;
let lastCapture = null;
let textH = null;

const log = (line) => { try { fs.appendFileSync(fpsLog, `${new Date().toISOString()} ${line}\n`); } catch { /* ignore */ } };

const webPreferences = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

function guard(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The harness never navigates by itself (loadFile does not go through will-navigate): deny all.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

const roomUrlOpts = (mode) => ({ query: { mode, variant: VARIANT } });
const loadRoom = (mode) => { roomMode = mode; return room.loadFile(path.join(__dirname, 'room.html'), roomUrlOpts(mode)); };

const recovery = createRecovery({
  now: () => performance.now(),
  showPlain: () => { showRoom(); loadRoom('plain'); },
});

// The room window stays hidden while the Godot program owns the room's screen (godot-native).
function showRoom() {
  if (room.isVisible()) return;
  room.showInactive();
  placeRoom(roomDisplayId);
}

function displayBounds() {
  const all = screen.getAllDisplays();
  return (all.find((x) => x.id === roomDisplayId) || all[0]).bounds;
}

function startNative() {
  stopNative();
  roomMode = 'scene';
  room.hide();
  const gen = ++nativeGen;
  const bounds = displayBounds();
  nativeBounds = bounds;
  const extra = (process.env.SPIKE_GODOT_ARGS || '').split(' ').filter(Boolean);
  const size = ROOM_SIZE.length === 2 && ROOM_SIZE[0] ? ROOM_SIZE : null;
  launchNative({
    exe: process.env.SPIKE_GODOT_BIN || defaultBinary(), args: buildArgs({ bounds, size, extra }), captureDir, log,
    onMessage: (m) => { if (gen === nativeGen) onNativeMessage(m); },
    onDead: (reason) => { if (gen !== nativeGen) return; native = null; nativeBounds = null; log(`native scene gone: ${reason}`); recovery.onSceneGone(); },
  }).then((n) => { if (gen === nativeGen) native = { ...n, bounds }; else n.stop(); })
    .catch((e) => { if (gen === nativeGen) { nativeBounds = null; log(`native launch failed: ${e.message}`); recovery.onSceneGone(); } });
  // Keep the keyboard on the presenter whatever the new window does.
  setTimeout(() => { if (presenter && !presenter.isDestroyed()) presenter.focus(); }, 1500);
}

function stopNative() { nativeGen++; const n = native; native = null; nativeBounds = null; if (n) n.stop(); }

function onNativeMessage(m) {
  if (m.type === 'fps' && Number.isFinite(m.v)) log(`fps mode=scene ${m.v.toFixed(1)}`);
  else if (m.type === 'hb' && m.textH && typeof m.textH === 'object') textH = m.textH;
  else if (m.type === 'captured' && typeof m.name === 'string' && /^[\w.-]+$/.test(m.name)) { lastCapture = m.name; log(`capture ${m.name}`); }
}

function setVariant(v) {
  stopNative();
  VARIANT = v;
  log(`variant ${v}`);
  if (v === 'godot-native') { startNative(); return; }
  showRoom();
  loadRoom('scene');
}

async function capture() {
  if (VARIANT === 'godot-native') { if (native) native.send({ type: 'capture' }); return; }
  if (!room || !room.isVisible()) return;
  const img = await room.webContents.capturePage();
  lastCapture = `${VARIANT}-${roomMode}-${Date.now()}.png`;
  fs.writeFileSync(path.join(captureDir, lastCapture), img.toPNG());
  log(`capture ${lastCapture}`);
}

function state() {
  return {
    ...clock.snapshot(),
    zones: ZONES,
    classDef: CLASS_DEF,
    roomMode,
    variant: VARIANT,
    variants: VARIANTS,
    lastCapture,
    recovery: lastRecovery,
    displays: listDisplays(),
  };
}

// What the scene gets: the clock and the class, nothing about windows or displays.
const sceneState = () => { const { displays, recovery: _r, variants, ...rest } = state(); return { type: 'state', ...rest }; };

function listDisplays() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    n: i + 1, id: d.id, primary: d.id === primary, bounds: d.bounds, scale: d.scaleFactor,
    room: d.id === roomDisplayId,
  }));
}

function placeRoom(displayId) {
  const all = screen.getAllDisplays();
  const d = all.find((x) => x.id === displayId) || all.find((x) => x.id !== screen.getPrimaryDisplay().id) || all[0];
  roomDisplayId = d.id;
  if (ROOM_SIZE.length === 2 && ROOM_SIZE[0]) { room.setContentSize(ROOM_SIZE[0], ROOM_SIZE[1]); return; }
  // A hidden room window (godot-native) only gets its bounds: full screen could show it over Godot.
  if (!room.isVisible()) { room.setBounds(d.bounds); return; }
  const b = room.getBounds();
  if (all.length > 1 && room.isFullScreen() && b.x === d.bounds.x && b.y === d.bounds.y && b.width === d.bounds.width && b.height === d.bounds.height) return; // already right: no flicker
  if (all.length === 1) { room.setFullScreen(false); room.setBounds({ x: d.bounds.x + 40, y: d.bounds.y + 40, width: 1280, height: 720 }); return; }
  room.setFullScreen(false);
  room.setBounds(d.bounds);
  room.setFullScreen(true);
}

// The Godot window cannot be moved from outside: when its display changed, start it again there.
function restartNativeIfMoved() {
  if (VARIANT === 'godot-native' && needsRestart(nativeBounds, displayBounds())) startNative();
}

function createWindows() {
  presenter = new BrowserWindow({ width: 900, height: 700, title: 'Presenter', webPreferences: webPreferences() });
  guard(presenter);
  presenter.loadFile(path.join(__dirname, 'presenter.html'));
  room = new BrowserWindow({
    width: ROOM_SIZE[0] || 1280, height: ROOM_SIZE[1] || 720, useContentSize: true, show: VARIANT !== 'godot-native',
    backgroundColor: '#05050a', title: 'Room', autoHideMenuBar: true,
    // The room screen is often unfocused or covered: never let Chromium throttle its animation.
    webPreferences: { ...webPreferences(), backgroundThrottling: false },
  });
  guard(room);
  room.webContents.on('render-process-gone', (_e, d) => { log(`gone reason=${d.reason} exit=${d.exitCode}`); if (roomMode === 'scene' && VARIANT !== 'godot-native') recovery.onSceneGone(); });
  room.webContents.on('did-finish-load', () => {
    if (roomMode === 'plain' && recovery.pending()) {
      recovery.onPlainShown();
      lastRecovery = recovery.result();
      log(`recovery ${JSON.stringify(lastRecovery)}`);
    }
  });
  placeRoom(null);
  if (VARIANT === 'godot-native') {
    startNative();
    // The plain 2D screen waits in the hidden room window, ready for recovery.
    room.loadFile(path.join(__dirname, 'room.html'), roomUrlOpts('plain'));
  } else loadRoom('scene');
  const refit = () => {
    if (!room) return;
    placeRoom(roomDisplayId);
    restartNativeIfMoved();
  };
  screen.on('display-added', refit);
  screen.on('display-removed', refit);
  screen.on('display-metrics-changed', (_e, display, changed) => { if (display.id === roomDisplayId && changed.includes('bounds')) refit(); });
}

function setMode(mode) {
  if (mode === roomMode) return;
  if (VARIANT !== 'godot-native') { loadRoom(mode); return; }
  if (mode === 'plain') { stopNative(); showRoom(); loadRoom('plain'); } else startNative();
}

function command(cmd) {
  switch (cmd.type) {
    case 'toggle': clock.toggle(); break;
    case 'reset': clock.reset(); break;
    case 'kill-scene':
      if (VARIANT === 'godot-native') { if (native) native.child.kill('SIGKILL'); } else if (roomMode === 'scene') room.webContents.forcefullyCrashRenderer();
      break;
    case 'mode': setMode(cmd.mode); break;
    case 'variant': if (cmd.variant !== VARIANT) setVariant(cmd.variant); break;
    case 'capture': capture().catch((e) => log(`capture failed: ${e.message}`)); break;
    case 'move-room': placeRoom(listDisplays()[cmd.n - 1]?.id); restartNativeIfMoved(); break;
    default: break;
  }
  return state();
}

app.whenReady().then(() => {
  fpsLog = process.env.SPIKE_FPS_LOG || path.join(app.getPath('userData'), 'fps.log');
  log(`start variant=${VARIANT} electron=${process.versions.electron} chrome=${process.versions.chrome}`);
  // No network: only file:// and the in-process godotweb:// scheme (the exported Godot web build) are allowed.
  godotWeb.handle(protocol);
  captureDir = process.env.SPIKE_CAPTURE_DIR || path.join(app.getPath('userData'), 'captures');
  fs.mkdirSync(captureDir, { recursive: true });
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('file://') && !d.url.startsWith('devtools://') && !d.url.startsWith(`${godotWeb.SCHEME}://`) }));
  // Deny every permission request (camera, notifications, ...): the harness needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // IPC: only the presenter may command; only the room may report fps; payloads are validated.
  const from = (e, win) => win && !win.isDestroyed() && e.sender === win.webContents;
  ipcMain.handle('state', (e) => (from(e, presenter) || from(e, room) ? state() : null));
  ipcMain.handle('command', (e, cmd) => {
    const c = from(e, presenter) ? parseCommand(cmd) : null;
    return c ? command(c) : null;
  });
  ipcMain.on('fps', (e, v) => { if (from(e, room) && Number.isFinite(v)) log(`fps mode=${roomMode} ${v.toFixed(1)}`); });
  createWindows();
  if (process.env.SPIKE_START_AT_S) clock.seek(Number(process.env.SPIKE_START_AT_S) * 1000); // test/screenshots only
  if (process.env.SPIKE_AUTOSTART === '1') clock.start();
  setInterval(() => {
    const s = state();
    for (const w of [presenter, room]) if (w && !w.isDestroyed() && !w.webContents.isCrashed()) w.webContents.send('state', s);
    if (native) native.send(sceneState());
  }, 100);
  if (TEST) process.spikeTest = { getNative: () => native, getNativeBounds: () => nativeBounds, restartNativeIfMoved, getTextH: () => textH, clock, getRoom: () => room, getRoomMode: () => roomMode, command, state };
  app.on('window-all-closed', () => app.quit());
});

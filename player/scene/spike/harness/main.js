'use strict';
// Spike 2 harness main process. Owns the fake class clock, so a dead scene renderer
// cannot touch it. Presenter window + room window. No network, no audio.
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createClock } = require('./clock');
const { CLASS_DEF, ZONES } = require('./class-def');
const { createRecovery } = require('./recovery');
const { parseCommand } = require('./commands');

const VARIANT = process.env.SPIKE_VARIANT || 'web';
const TEST = process.env.SPIKE_TEST === '1';
const ROOM_SIZE = (process.env.SPIKE_ROOM_SIZE || '').split('x').map(Number); // windowed size for tests
const clock = createClock(CLASS_DEF, () => performance.now()); // monotonic: immune to system clock steps
let presenter = null;
let room = null;
let roomMode = 'scene';
let roomDisplayId = null;
let lastRecovery = null;
let fpsLog = null;

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
  showPlain: () => { loadRoom('plain'); },
});

function state() {
  return {
    ...clock.snapshot(),
    zones: ZONES,
    classDef: CLASS_DEF,
    roomMode,
    recovery: lastRecovery,
    displays: listDisplays(),
  };
}

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
  const b = room.getBounds();
  if (all.length > 1 && room.isFullScreen() && b.x === d.bounds.x && b.y === d.bounds.y && b.width === d.bounds.width && b.height === d.bounds.height) return; // already right: no flicker
  if (all.length === 1) { room.setFullScreen(false); room.setBounds({ x: d.bounds.x + 40, y: d.bounds.y + 40, width: 1280, height: 720 }); return; }
  room.setFullScreen(false);
  room.setBounds(d.bounds);
  room.setFullScreen(true);
}

function createWindows() {
  presenter = new BrowserWindow({ width: 900, height: 700, title: 'Presenter', webPreferences: webPreferences() });
  guard(presenter);
  presenter.loadFile(path.join(__dirname, 'presenter.html'));
  room = new BrowserWindow({
    width: ROOM_SIZE[0] || 1280, height: ROOM_SIZE[1] || 720, useContentSize: true, show: true,
    backgroundColor: '#05050a', title: 'Room', autoHideMenuBar: true,
    // The room screen is often unfocused or covered: never let Chromium throttle its animation.
    webPreferences: { ...webPreferences(), backgroundThrottling: false },
  });
  guard(room);
  room.webContents.on('render-process-gone', (_e, d) => { log(`gone reason=${d.reason} exit=${d.exitCode}`); if (roomMode === 'scene') recovery.onSceneGone(); });
  room.webContents.on('did-finish-load', () => {
    if (roomMode === 'plain' && recovery.pending()) {
      recovery.onPlainShown();
      lastRecovery = recovery.result();
      log(`recovery ${JSON.stringify(lastRecovery)}`);
    }
  });
  loadRoom('scene');
  placeRoom(null);
  const refit = () => { if (room) placeRoom(roomDisplayId); };
  screen.on('display-added', refit);
  screen.on('display-removed', refit);
  screen.on('display-metrics-changed', (_e, display, changed) => { if (display.id === roomDisplayId && changed.includes('bounds')) refit(); });
}

function command(cmd) {
  switch (cmd.type) {
    case 'toggle': clock.toggle(); break;
    case 'reset': clock.reset(); break;
    case 'kill-scene': if (roomMode === 'scene') room.webContents.forcefullyCrashRenderer(); break;
    case 'mode': if (cmd.mode !== roomMode) loadRoom(cmd.mode); break;
    case 'move-room': placeRoom(listDisplays()[cmd.n - 1]?.id); break;
    default: break;
  }
  return state();
}

app.whenReady().then(() => {
  fpsLog = process.env.SPIKE_FPS_LOG || path.join(app.getPath('userData'), 'fps.log');
  log(`start variant=${VARIANT} electron=${process.versions.electron} chrome=${process.versions.chrome}`);
  // No network: only file:// is ever allowed.
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('file://') && !d.url.startsWith('devtools://') }));
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
  }, 100);
  if (TEST) process.spikeTest = { clock, getRoom: () => room, getRoomMode: () => roomMode, command, state };
  app.on('window-all-closed', () => app.quit());
});

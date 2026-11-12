'use strict';
// Godot as its own program, started by the shell: spawn it, open the 127.0.0.1 link, and call
// onDead(reason) once when the process exits or stops answering for 2 s. The spawn function is
// injected so tests use a fake child process.
const childProcess = require('node:child_process');
const path = require('node:path');
const { startLink } = require('./godot-link');
const { createWatchdog } = require('./watchdog');

const BUILD = path.join(__dirname, '..', 'godot', 'build');

// Where tools/godot.js exports the native build; SPIKE_GODOT_BIN overrides (an editor binary works too
// with SPIKE_GODOT_ARGS="--path <project>").
function defaultBinary(platform = process.platform) {
  if (platform === 'win32') return path.join(BUILD, 'windows', 'classbeat-spike-scene.exe');
  if (platform === 'darwin') return path.join(BUILD, 'macos', 'classbeat spike scene.app', 'Contents', 'MacOS', 'classbeat spike scene');
  return path.join(BUILD, 'linux', 'classbeat-spike-scene.x86_64');
}

// Pure: command line for a full-screen launch on the display at `bounds`, or a window of `size` (tests).
function buildArgs({ bounds, size, extra = [] }) {
  const win = size && size[0]
    ? ['--windowed', '--resolution', `${size[0]}x${size[1]}`, '--position', '0,0']
    : ['--fullscreen', '--position', `${bounds.x},${bounds.y}`];
  return [...extra, ...win];
}

async function launchNative({
  exe, args, captureDir, onMessage, onDead, spawn = childProcess.spawn, log = () => {},
  silenceMs, startupMs, setTimer, clearTimer,
}) {
  let stopped = false;
  const lines = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    wd.stop();
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    link.close();
  };
  const wd = createWatchdog({ silenceMs, startupMs, setTimer, clearTimer, onDead: (reason) => { log(`godot dead: ${reason} ${lines.slice(-3).join(' | ')}`); stop(); onDead(reason); } });
  const link = await startLink({ onMessage: (m) => { wd.heard(); onMessage(m); }, onConnect: () => wd.heard() });
  const child = spawn(exe, args, {
    env: { ...process.env, SPIKE_LINK_PORT: String(link.port), SPIKE_LINK_TOKEN: link.token, SPIKE_CAPTURE_DIR: captureDir || '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const keep = (d) => { for (const l of String(d).split('\n')) if (l.trim()) lines.push(l.trim().slice(0, 200)); if (lines.length > 40) lines.splice(0, 20); };
  if (child.stdout) child.stdout.on('data', keep);
  if (child.stderr) child.stderr.on('data', keep);
  child.on('exit', (code, signal) => wd.exited({ code, signal }));
  child.on('error', (e) => { lines.push(String(e.message)); wd.exited({ error: e }); });
  wd.start();
  return { send: (o) => link.send(o), stop, link, child, isStopped: () => stopped };
}

module.exports = { launchNative, buildArgs, defaultBinary };

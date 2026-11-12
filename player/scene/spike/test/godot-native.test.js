'use strict';
// Recovery rule for the native Godot variant, with a fake child process (no Godot, no window).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const { launchNative, buildArgs } = require('../harness/godot-native');
const { fakeTimers } = require('./fake-timers');

function fakeChild() {
  const c = new EventEmitter();
  c.killed = [];
  c.kill = (sig) => { c.killed.push(sig); setImmediate(() => c.emit('exit', null, sig)); return true; };
  return c;
}

async function setup(opts = {}) {
  const f = fakeTimers(); const dead = []; const msgs = []; let env = null; let args = null;
  const child = fakeChild();
  const n = await launchNative({
    exe: '/fake/godot', args: ['--x'], onMessage: (m) => msgs.push(m), onDead: (r) => dead.push(r),
    setTimer: f.setTimer, clearTimer: f.clearTimer,
    spawn: (exe, a, o) => { env = o.env; args = a; return child; }, ...opts,
  });
  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${env.SPIKE_LINK_PORT}/`, { headers: { Authorization: `Bearer ${env.SPIKE_LINK_TOKEN}` } });
    ws.on('open', () => resolve(ws)); ws.on('error', reject);
  });
  return { n, f, dead, msgs, child, env, args, connect };
}
const tick = () => new Promise((r) => setTimeout(r, 50));

test('the child gets the port and a random token in its environment, never on its command line', async () => {
  const s = await setup();
  try {
    assert.match(s.env.SPIKE_LINK_PORT, /^\d+$/);
    assert.match(s.env.SPIKE_LINK_TOKEN, /^[0-9a-f]{48}$/);
    assert.deepEqual(s.args, ['--x']);
  } finally { s.n.stop(); }
});

test('child goes silent: after 2 s without a message the shell kills it and reports it dead', async () => {
  const s = await setup();
  const ws = await s.connect();
  ws.send(JSON.stringify({ type: 'hb' }));
  await tick();
  assert.deepEqual(s.msgs, [{ type: 'hb' }]);
  s.f.advance(1999);
  assert.deepEqual(s.dead, []);
  s.f.advance(1);
  assert.deepEqual(s.dead, ['silent']);
  await tick();
  assert.deepEqual(s.child.killed, ['SIGKILL']);
  assert.equal(s.n.isStopped(), true);
  ws.on('error', () => {});
});

test('a message keeps the child alive; a message after 1.9 s restarts the 2 s', async () => {
  const s = await setup();
  const ws = await s.connect();
  s.f.advance(1900);
  ws.send(JSON.stringify({ type: 'hb' })); await tick();
  s.f.advance(1900);
  assert.deepEqual(s.dead, []);
  s.f.advance(100);
  assert.deepEqual(s.dead, ['silent']);
  ws.on('error', () => {});
});

test('child dies: reported at once as an exit, link closed', async () => {
  const s = await setup();
  const ws = await s.connect();
  ws.on('error', () => {});
  s.child.emit('exit', 139, null);
  assert.deepEqual(s.dead, ['exit']);
  s.f.advance(60000);
  assert.deepEqual(s.dead, ['exit']);
  assert.equal(s.n.isStopped(), true);
});

test('child that cannot even start (spawn error) is reported dead', async () => {
  const s = await setup();
  s.child.emit('error', new Error('ENOENT'));
  assert.deepEqual(s.dead, ['exit']);
});

test('child that never connects is dead after the startup allowance', async () => {
  const s = await setup();
  s.f.advance(14999);
  assert.deepEqual(s.dead, []);
  s.f.advance(1);
  assert.deepEqual(s.dead, ['no-start']);
});

test('an intended stop is not a failure', async () => {
  const s = await setup();
  const ws = await s.connect(); ws.on('error', () => {});
  s.n.stop();
  await tick();
  s.f.advance(60000);
  assert.deepEqual(s.dead, []);
  assert.deepEqual(s.child.killed, ['SIGKILL']);
});

test('command line: full screen at the display origin, or a window of the test size', () => {
  assert.deepEqual(buildArgs({ bounds: { x: 1920, y: 0 } }), ['--fullscreen', '--position', '1920,0']);
  assert.deepEqual(buildArgs({ bounds: { x: 0, y: 0 }, size: [1280, 720], extra: ['--path', 'p'] }),
    ['--path', 'p', '--windowed', '--resolution', '1280x720', '--position', '0,0']);
});

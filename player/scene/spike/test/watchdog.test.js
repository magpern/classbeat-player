'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWatchdog } = require('../harness/watchdog');
const { fakeTimers } = require('./fake-timers');

function make() {
  const f = fakeTimers(); const dead = [];
  const wd = createWatchdog({ ...f, onDead: (r) => dead.push(r) });
  return { f, dead, wd };
}

test('silent for 2 s after the last message: dead; a message in time keeps it alive', () => {
  const { f, dead, wd } = make();
  wd.start(); wd.heard();
  f.advance(1900); wd.heard(); // answered in time
  f.advance(1900);
  assert.deepEqual(dead, []);
  f.advance(100); // 2000 ms since the last message
  assert.deepEqual(dead, ['silent']);
  assert.equal(wd.state(), 'dead');
});

test('process exit is dead at once, and only reported once', () => {
  const { f, dead, wd } = make();
  wd.start(); wd.heard();
  wd.exited({ code: null, signal: 'SIGKILL' });
  wd.exited({ code: 1 });
  f.advance(10000);
  assert.deepEqual(dead, ['exit-SIGKILL']);
});

test('never starts: dead after the startup allowance (15 s), not after 2 s', () => {
  const { f, dead, wd } = make();
  wd.start();
  f.advance(14999);
  assert.deepEqual(dead, []);
  f.advance(1);
  assert.deepEqual(dead, ['no-start']);
});

test('stop() cancels everything: no report for an intended stop, late messages ignored', () => {
  const { f, dead, wd } = make();
  wd.start(); wd.heard(); wd.stop();
  wd.heard(); wd.exited({ signal: 'SIGKILL' });
  f.advance(60000);
  assert.deepEqual(dead, []);
  assert.equal(f.pending(), 0);
});

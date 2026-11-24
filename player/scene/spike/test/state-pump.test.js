'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatePump } = require('../harness/state-pump');
const { fakeTimers } = require('./fake-timers');

// Steps fake time 1 ms at a time and counts the sends in each whole second.
function sendsPerSecond(opts, seconds) {
  const f = fakeTimers(); let n = 0;
  createStatePump({ send: () => { n += 1; }, ...f, setTimer: f.setTimer, clearTimer: f.clearTimer, ...opts }).start();
  const counts = [];
  for (let s = 0; s < seconds; s += 1) { const before = n; for (let ms = 0; ms < 1000; ms += 1) f.advance(1); counts.push(n - before); }
  return counts;
}

test('state is sent about 10 times a second', () => {
  for (const c of sendsPerSecond({}, 3)) assert.ok(c >= 9 && c <= 11, `${c} sends in one second`);
});

test('a wrong rate fails the same check (5 and 20 a second)', () => {
  for (const intervalMs of [200, 50]) for (const c of sendsPerSecond({ intervalMs }, 1)) assert.ok(c < 9 || c > 11, `${c}`);
});

test('stop ends the sending', () => {
  const f = fakeTimers(); let n = 0;
  const p = createStatePump({ send: () => { n += 1; }, ...f });
  p.start(); f.advance(100); p.stop(); f.advance(1000);
  assert.equal(n, 1);
});

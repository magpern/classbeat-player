'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecovery } = require('../harness/recovery');
const { createClock } = require('../harness/clock');
const { CLASS_DEF } = require('../harness/class-def');

function fakeTimers() {
  let t = 0; const q = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; q.push(h); return h; },
    clearTimer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    advance(ms) { t += ms; for (const h of [...q]) if (h.at <= t) { q.splice(q.indexOf(h), 1); h.fn(); } },
  };
}

test('scene killed: plain screen shown at 400 ms is within the 2 s rule', () => {
  const f = fakeTimers(); let shown = 0;
  const r = createRecovery({ ...f, showPlain: () => { shown++; } });
  r.onSceneGone();
  assert.equal(shown, 1);
  f.advance(400); r.onPlainShown();
  assert.deepEqual(r.result(), { ok: true, latencyMs: 400 });
  f.advance(5000);
  assert.equal(r.result().ok, true); // the watchdog does not fire after success
});

test('plain screen not shown within 2 s is reported as a failure', () => {
  const f = fakeTimers();
  const r = createRecovery({ ...f, showPlain: () => {} });
  r.onSceneGone(); f.advance(2001);
  assert.equal(r.result().ok, false);
  assert.equal(r.pending(), false);
});

test('shown 1 ms before the deadline passes; repeated gone events are ignored', () => {
  const f = fakeTimers(); let shown = 0;
  const r = createRecovery({ ...f, showPlain: () => { shown++; } });
  r.onSceneGone(); r.onSceneGone();
  assert.equal(shown, 1);
  f.advance(1999); r.onPlainShown();
  assert.equal(r.result().ok, true);
});

test('clock time is continuous across a scene kill and recovery', () => {
  const f = fakeTimers();
  const c = createClock(CLASS_DEF, f.now);
  const r = createRecovery({ ...f, showPlain: () => {} });
  c.start(); f.advance(30000);
  const before = c.elapsedMs();
  r.onSceneGone(); f.advance(700); r.onPlainShown();
  assert.equal(c.elapsedMs() - before, 700);
  assert.equal(c.running(), true);
});

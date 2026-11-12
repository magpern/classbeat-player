'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClock, snapshotAt } = require('../harness/clock');
const { CLASS_DEF } = require('../harness/class-def');

test('class definition: 10 minutes, contiguous intervals', () => {
  assert.equal(CLASS_DEF.durationMs, 600000);
  let t = 0;
  for (const i of CLASS_DEF.intervals) { assert.equal(i.start, t); t = i.end; }
  assert.equal(t, 600000);
});

test('snapshotAt picks interval, remaining time and next', () => {
  const s = snapshotAt(CLASS_DEF, 100000);
  assert.equal(s.interval.name, 'Build');
  assert.equal(s.remainingMs, 80000);
  assert.equal(s.next.name, 'Push');
  assert.equal(snapshotAt(CLASS_DEF, 90000).interval.name, 'Build');
  assert.equal(snapshotAt(CLASS_DEF, 599999).next, null);
});

test('snapshotAt clamps and finishes', () => {
  assert.equal(snapshotAt(CLASS_DEF, -5).elapsedMs, 0);
  const s = snapshotAt(CLASS_DEF, 9e9);
  assert.equal(s.finished, true);
  assert.equal(s.remainingMs, 0);
});

test('clock runs, pauses, resumes and resets on injected time', () => {
  let now = 1000;
  const c = createClock(CLASS_DEF, () => now);
  assert.equal(c.elapsedMs(), 0);
  c.start(); now += 5000;
  assert.equal(c.elapsedMs(), 5000);
  c.pause(); now += 7000;
  assert.equal(c.elapsedMs(), 5000);
  c.toggle(); now += 1000;
  assert.equal(c.snapshot().elapsedMs, 6000);
  assert.equal(c.snapshot().running, true);
  c.reset();
  assert.equal(c.elapsedMs(), 0);
});

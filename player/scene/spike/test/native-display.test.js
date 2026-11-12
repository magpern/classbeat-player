'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { needsRestart } = require('../harness/native-display');

const a = { x: 0, y: 0, width: 1920, height: 1080 };

test('same display bounds: no restart', () => assert.equal(needsRestart(a, { ...a }), false));
test('no Godot running or starting: no restart', () => {
  assert.equal(needsRestart(null, a), false);
  assert.equal(needsRestart(undefined, a), false);
});
test('no target display: no restart', () => assert.equal(needsRestart(a, null), false));
test('any bounds field differing means a restart', () => {
  for (const k of ['x', 'y', 'width', 'height']) assert.equal(needsRestart(a, { ...a, [k]: a[k] + 1 }), true, k);
});

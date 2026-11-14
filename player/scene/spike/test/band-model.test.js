'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bandVisible } = require('../harness/band-model');

test('shown while the class is not running', () => assert.equal(bandVisible({ running: false, wakeAt: null, now: 1e6 }), true));
test('hidden with the class running and no key or mouse move', () => assert.equal(bandVisible({ running: true, wakeAt: null, now: 1e6 }), false));
test('back on a key or mouse move, then hidden again after the hold time', () => {
  assert.equal(bandVisible({ running: true, wakeAt: 1000, now: 1500 }), true);
  assert.equal(bandVisible({ running: true, wakeAt: 1000, now: 1000 + 3999 }), true);
  assert.equal(bandVisible({ running: true, wakeAt: 1000, now: 1000 + 4000 }), false);
});

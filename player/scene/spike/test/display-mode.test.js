'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseDisplayMode } = require('../harness/display-mode');

test('one display: one-screen mode, the default', () => assert.equal(chooseDisplayMode({ count: 1 }), 'one'));
test('two or more displays: the second-display layout stays', () => {
  assert.equal(chooseDisplayMode({ count: 2 }), 'two');
  assert.equal(chooseDisplayMode({ count: 3 }), 'two');
});
test('a windowed test size keeps the old layout', () => assert.equal(chooseDisplayMode({ count: 1, sized: true }), 'two'));
test('a forced mode wins', () => {
  assert.equal(chooseDisplayMode({ count: 2, forced: 'one' }), 'one');
  assert.equal(chooseDisplayMode({ count: 1, sized: true, forced: 'one' }), 'one');
  assert.equal(chooseDisplayMode({ count: 1, forced: 'two' }), 'two');
  assert.equal(chooseDisplayMode({ count: 1, forced: 'bogus' }), 'one');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { routeKey } = require('../harness/keymap');
const { parseCommand } = require('../harness/commands');

const cur = { variants: ['web', 'godot-native', 'godot-web'], variant: 'web' };

test('every key maps to the command the presenter has always sent', () => {
  assert.deepEqual(routeKey(' ', cur), { type: 'toggle' });
  assert.deepEqual(routeKey('r', cur), { type: 'reset' });
  assert.deepEqual(routeKey('K', cur), { type: 'kill-scene' });
  assert.deepEqual(routeKey('p', cur), { type: 'mode', mode: 'plain' });
  assert.deepEqual(routeKey('s', cur), { type: 'mode', mode: 'scene' });
  assert.deepEqual(routeKey('c', cur), { type: 'capture' });
  assert.deepEqual(routeKey('3', cur), { type: 'move-room', n: 3 });
});
test('V cycles the variants and wraps', () => {
  assert.deepEqual(routeKey('v', cur), { type: 'variant', variant: 'godot-native' });
  assert.deepEqual(routeKey('v', { ...cur, variant: 'godot-web' }), { type: 'variant', variant: 'web' });
  assert.equal(routeKey('v', { variants: [], variant: '' }), null);
});
test('other keys do nothing, and every routed command passes the IPC allowlist', () => {
  for (const k of ['x', 'Enter', '0', 'Escape']) assert.equal(routeKey(k, cur), null, k);
  for (const k of [' ', 'r', 'k', 'p', 's', 'c', 'v', '1']) assert.notEqual(parseCommand(routeKey(k, cur)), null, k);
});

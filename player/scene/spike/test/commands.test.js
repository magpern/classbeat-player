'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand } = require('../harness/commands');

test('known commands pass, extra fields are dropped', () => {
  assert.deepEqual(parseCommand({ type: 'toggle', junk: 1 }), { type: 'toggle' });
  assert.deepEqual(parseCommand({ type: 'mode', mode: 'plain' }), { type: 'mode', mode: 'plain' });
  assert.deepEqual(parseCommand({ type: 'move-room', n: 2 }), { type: 'move-room', n: 2 });
});

test('bad shapes are rejected', () => {
  for (const bad of [null, undefined, 5, 'toggle', [], {}, { type: 'rm' }, { type: 'mode', mode: 'x' },
    { type: 'move-room', n: 0 }, { type: 'move-room', n: 10 }, { type: 'move-room', n: 1.5 }, { type: 'move-room', n: '2' }]) {
    assert.equal(parseCommand(bad), null, JSON.stringify(bad));
  }
});

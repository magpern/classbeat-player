'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVariant, nextVariant, VARIANTS } = require('../harness/variant');

test('the three variants, web by default, launch option beats the environment', () => {
  assert.deepEqual(VARIANTS, ['web', 'godot-native', 'godot-web']);
  assert.equal(parseVariant({}, []), 'web');
  assert.equal(parseVariant({ SPIKE_VARIANT: 'godot-web' }, []), 'godot-web');
  assert.equal(parseVariant({ SPIKE_VARIANT: 'godot-web' }, ['x', '--variant=godot-native']), 'godot-native');
});

test('anything else is refused', () => {
  for (const bad of ['godot', '../web', 'web ', 'GODOT-NATIVE', '']) {
    assert.throws(() => parseVariant({}, [`--variant=${bad}`]), /unknown variant/, bad);
  }
});

test('the presenter cycles through the variants', () => {
  assert.equal(nextVariant('web'), 'godot-native');
  assert.equal(nextVariant('godot-native'), 'godot-web');
  assert.equal(nextVariant('godot-web'), 'web');
});

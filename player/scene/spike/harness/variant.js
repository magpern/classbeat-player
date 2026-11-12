'use strict';
// Pure: which scene variant to run. Launch option `--variant=<v>` or SPIKE_VARIANT, default `web`.
// Anything not on the list is refused (the value ends up in a file path and a URL).
const VARIANTS = ['web', 'godot-native', 'godot-web'];

function parseVariant(env, argv) {
  const arg = (argv || []).find((a) => typeof a === 'string' && a.startsWith('--variant='));
  const v = arg ? arg.slice('--variant='.length) : (env && env.SPIKE_VARIANT) || 'web';
  if (!VARIANTS.includes(v)) throw new Error(`unknown variant "${v}"; use one of ${VARIANTS.join(', ')}`);
  return v;
}

const nextVariant = (v) => VARIANTS[(VARIANTS.indexOf(v) + 1) % VARIANTS.length];

module.exports = { VARIANTS, parseVariant, nextVariant };

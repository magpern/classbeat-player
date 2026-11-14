'use strict';
// Pure keyboard routing shared by the presenter window and the one-screen controls band.
// `key` is KeyboardEvent.key, `current` the latest state ({ variants, variant }). Returns the
// command to send, or null when the key means nothing.
function routeKey(key, current) {
  if (key === ' ') return { type: 'toggle' };
  const k = String(key).toLowerCase();
  if (k === 'r') return { type: 'reset' };
  if (k === 'k') return { type: 'kill-scene' };
  if (k === 'p') return { type: 'mode', mode: 'plain' };
  if (k === 's') return { type: 'mode', mode: 'scene' };
  if (k === 'c') return { type: 'capture' };
  if (k === 'v') {
    const vs = (current && current.variants) || [];
    if (!vs.length) return null;
    return { type: 'variant', variant: vs[(vs.indexOf(current.variant) + 1) % vs.length] };
  }
  if (/^[1-9]$/.test(k)) return { type: 'move-room', n: Number(k) };
  return null;
}

if (typeof module !== 'undefined') module.exports = { routeKey };
else window.SpikeKeymap = { routeKey };

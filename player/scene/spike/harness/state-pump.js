'use strict';
// Sends the clock state to every window and to Godot, STATE_HZ times a second. The timer is injected
// so a test steps time by hand instead of waiting for it. No I/O of its own.
const STATE_HZ = 10;
const STATE_INTERVAL_MS = 1000 / STATE_HZ;

function createStatePump({ send, setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = STATE_INTERVAL_MS }) {
  let timer = null;
  const tick = () => { timer = setTimer(tick, intervalMs); send(); };
  return {
    start() { if (timer === null) timer = setTimer(tick, intervalMs); },
    stop() { if (timer !== null) { clearTimer(timer); timer = null; } },
  };
}

module.exports = { createStatePump, STATE_HZ, STATE_INTERVAL_MS };

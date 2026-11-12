'use strict';
// Pure supervisor for the Godot program: it is dead when the process has exited, or when it has been
// silent for silenceMs (default 2 s, plan section 9). Before the first message it gets startupMs to
// start and connect. Timers are injected so it is testable. No I/O.

function createWatchdog({ onDead, silenceMs = 2000, startupMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let state = 'idle'; // idle | starting | alive | dead
  const arm = (ms, reason) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; die(reason); }, ms);
  };
  function die(reason) {
    if (state === 'dead' || state === 'idle') return;
    state = 'dead';
    if (timer !== null) { clearTimer(timer); timer = null; }
    onDead(reason);
  }
  return {
    start() { state = 'starting'; arm(startupMs, 'no-start'); },
    heard() { if (state === 'starting' || state === 'alive') { state = 'alive'; arm(silenceMs, 'silent'); } },
    exited(info) { die(info && info.signal ? `exit-${info.signal}` : 'exit'); },
    stop() { if (timer !== null) { clearTimer(timer); timer = null; } state = 'idle'; },
    state: () => state,
  };
}

module.exports = { createWatchdog };

'use strict';
// Pure rule: is the one-screen controls band shown? Always while the class is not running;
// with the class running only for `holdMs` after the last key or mouse move (`wakeAt`, or null).
function bandVisible({ running, wakeAt, now, holdMs = 4000 }) {
  if (!running) return true;
  return wakeAt !== null && wakeAt !== undefined && now - wakeAt < holdMs;
}

if (typeof module !== 'undefined') module.exports = { bandVisible };
else window.SpikeBand = { bandVisible };

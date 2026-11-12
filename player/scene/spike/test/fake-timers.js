'use strict';
// A fake clock and scheduler for tests: time moves only when advance() is called.
function fakeTimers() {
  let t = 0; const q = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; q.push(h); return h; },
    clearTimer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    advance(ms) { t += ms; for (const h of [...q].sort((a, b) => a.at - b.at)) if (h.at <= t && q.includes(h)) { q.splice(q.indexOf(h), 1); h.fn(); } },
    pending: () => q.length,
  };
}
module.exports = { fakeTimers };

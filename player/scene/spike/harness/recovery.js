'use strict';
// Pure recovery rule: when the scene renderer is gone, the room window must show the plain
// 2D screen within deadlineMs. Time and the scheduler are injected so it is testable. No I/O.

function createRecovery({ now, showPlain, deadlineMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let goneAt = null;
  let timer = null;
  let result = null; // { ok, latencyMs }
  const finish = (ok) => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    result = { ok, latencyMs: now() - goneAt };
    goneAt = null;
  };
  return {
    onSceneGone() {
      if (goneAt !== null) return;
      goneAt = now();
      result = null;
      timer = setTimer(() => { if (goneAt !== null) finish(false); }, deadlineMs);
      showPlain();
    },
    onPlainShown() {
      if (goneAt === null) return;
      finish(now() - goneAt <= deadlineMs);
    },
    pending: () => goneAt !== null,
    result: () => result,
  };
}

module.exports = { createRecovery };

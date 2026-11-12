'use strict';
// Pure fake class clock. No I/O. Lives in the main process only.

function snapshotAt(def, elapsedMs) {
  const e = Math.max(0, Math.min(elapsedMs, def.durationMs));
  const finished = e >= def.durationMs;
  let index = def.intervals.findIndex((i) => e >= i.start && e < i.end);
  if (index < 0) index = finished ? def.intervals.length - 1 : 0;
  const interval = def.intervals[index];
  const songIndex = Math.max(0, def.songs.findIndex((x) => e >= x.start && e < x.end));
  return {
    elapsedMs: e,
    totalMs: def.durationMs,
    finished,
    index,
    interval,
    remainingMs: Math.max(0, interval.end - e),
    next: def.intervals[index + 1] || null,
    song: def.songs[songIndex],
  };
}

function createClock(def, nowFn) {
  let accMs = 0;
  let startedAt = null;
  const elapsed = () => accMs + (startedAt === null ? 0 : nowFn() - startedAt);
  return {
    start() { if (startedAt === null) startedAt = nowFn(); },
    pause() { if (startedAt !== null) { accMs += nowFn() - startedAt; startedAt = null; } },
    seek(ms) { accMs = ms; if (startedAt !== null) startedAt = nowFn(); },
    reset() { accMs = 0; startedAt = null; },
    toggle() { if (startedAt === null) this.start(); else this.pause(); },
    running: () => startedAt !== null,
    elapsedMs: elapsed,
    snapshot() { return { ...snapshotAt(def, elapsed()), running: startedAt !== null }; },
  };
}

module.exports = { createClock, snapshotAt };

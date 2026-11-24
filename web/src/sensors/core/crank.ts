// Cadence from crank revolutions (CSC and Cycling Power): the 16-bit revolution counter and the
// 16-bit event time (1/1024 s) both wrap, so each difference is taken modulo 65536.
export interface Crank {
  readonly revs: number;
  readonly time: number;
}

const WRAP = 0x10000;

/** rpm between two crank events, or null when no new event happened (same time) or the step is absurd. */
export function crankCadence(prev: Crank, cur: Crank): number | null {
  const dt = (cur.time - prev.time + WRAP) % WRAP;
  if (dt === 0) return null;
  const dr = (cur.revs - prev.revs + WRAP) % WRAP;
  const rpm = (dr * 1024 * 60) / dt;
  return rpm > 300 ? null : rpm;
}

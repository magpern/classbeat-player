// Cadence from crank revolutions (CSC and Cycling Power): the 16-bit revolution counter and the
// 16-bit event time (1/1024 s) both wrap, so each difference is taken modulo 65536.
import { FRESH_MS, type Stamped } from "./freshness.ts";

export interface Crank {
  readonly revs: number;
  readonly time: number;
}

const WRAP = 0x10000;

/**
 * rpm between two crank events, or null when no new event happened (same time), the step is absurd,
 * or the samples are more than the freshness window apart (the counters wrap every 64 s, so a
 * longer gap cannot be told from a short one).
 */
export function crankCadence(prevSample: Stamped<Crank>, curSample: Stamped<Crank>): number | null {
  const gap = curSample.at - prevSample.at;
  if (gap < 0 || gap > FRESH_MS) return null;
  const prev = prevSample.value;
  const cur = curSample.value;
  const dt = (cur.time - prev.time + WRAP) % WRAP;
  if (dt === 0) return null;
  const dr = (cur.revs - prev.revs + WRAP) % WRAP;
  const rpm = (dr * 1024 * 60) / dt;
  return rpm > 300 ? null : rpm;
}

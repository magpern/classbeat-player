// A fake treadmill and foot-pod source: replays the hand-built notifications of
// web/fixtures/sensors/running.json through the pure decoders. Nothing here opens a sensor.
import { decodeRunning, type RunKind, type RunMeasure } from "./core/index.ts";
import { replay, type Recorded } from "./fake-replay.ts";

export interface RunSample {
  readonly t: number;
  readonly measure: RunMeasure;
  readonly value: number;
}

/** Every reading the recorded notifications give, in time order. */
export function replayRunning(kind: RunKind, entries: readonly Recorded[]): RunSample[] {
  const out: RunSample[] = [];
  replay(entries, (view, t) => {
    for (const r of decodeRunning(kind, view)) out.push({ t, ...r });
  });
  return out;
}

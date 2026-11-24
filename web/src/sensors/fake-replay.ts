// A fake that replays recorded notifications (web/fixtures/sensors) for tests and the harness.
// Nothing here touches Bluetooth; the caller passes the entries and a clock-free `emit`.
export interface Recorded {
  readonly t: number;
  readonly hex: string;
}

export function hexToView(hex: string): DataView {
  const bytes = new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  return new DataView(bytes.buffer);
}

/** Calls `emit(view, t)` for each entry in time order; returns the entries' last time. */
export function replay(entries: readonly Recorded[], emit: (view: DataView, t: number) => void): number {
  let last = 0;
  for (const e of [...entries].sort((a, b) => a.t - b.t)) {
    emit(hexToView(e.hex), e.t);
    last = e.t;
  }
  return last;
}

// The room window's one place that decides when a visible change of the control band, the join sheet or its
// "New code" plate reaches the screen (core/room/marks.ts has the placement). A change asks for a mark; when its
// frame is free it is applied at once, else at the earliest frame at least 500 ms from the last mark. Every
// change is one step: nothing here runs a transition or an animation.
import { NO_MARKS, placeChange, recordMark } from "../core/room/marks.ts";
import type { Ledger } from "../core/room/marks.ts";

export interface Marks {
  /**
   * Asks for `apply` to run in a frame of its own. `apply` draws what is wanted when it runs (so a later request
   * under the same key is the same request) and returns whether anything on screen changed: only then is a mark used.
   */
  request(key: string, apply: () => boolean): void;
  /** Drops a pending request whose change is no longer wanted. */
  cancel(key: string): void;
}

export function createMarks(now: () => number = () => performance.now()): Marks {
  let ledger: Ledger = NO_MARKS;
  const pending = new Map<string, { apply: () => boolean; timer: ReturnType<typeof setTimeout> | undefined }>();

  function fire(key: string): void {
    const p = pending.get(key);
    if (!p) return;
    // On the millisecond grid, so two changes asked for in the same frame land on the same mark.
    const t = Math.floor(now());
    const at = placeChange(ledger, t);
    // A mark since the request may have taken this frame: placed again, after it.
    if (at - t >= 1) {
      p.timer = setTimeout(() => fire(key), at - t);
      return;
    }
    pending.delete(key);
    if (p.apply()) ledger = recordMark(ledger, at);
  }

  return {
    request(key, apply) {
      const p = pending.get(key);
      if (p) {
        p.apply = apply;
        return;
      }
      pending.set(key, { apply, timer: undefined });
      fire(key);
    },
    cancel(key) {
      clearTimeout(pending.get(key)?.timer);
      pending.delete(key);
    },
  };
}

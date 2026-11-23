// How the control band, the join sheet and its "New code" plate book their visible changes (room-2d.md, S6): every one
// is a mark in the room window's one ledger, asked of the room screen (`screen.requestMark`, #609). The ledger places
// it against the screen's own marks and the band's; this file adds no placement of its own, no timer and no clock.
// A change is one step: nothing here runs a transition or an animation.

/** What the room screen's `requestMark` gives back: the frame it was placed in, and a way to give it up. */
export interface MarkTicket {
  readonly atMs: number;
  cancel(): void;
}
export type RequestMark = (draw: () => void) => MarkTicket;

export interface Marks {
  /**
   * Books `draw` as a mark under `key`. A second request under a key that is still waiting changes nothing: `draw`
   * reads what is wanted when it runs, so the waiting mark already covers it.
   */
  request(key: string, draw: () => void): void;
  /** Gives up a waiting mark whose change is no longer wanted. */
  cancel(key: string): void;
}

export function createMarks(requestMark: RequestMark): Marks {
  const waiting = new Map<string, MarkTicket>();
  return {
    request(key, draw) {
      if (waiting.has(key)) return;
      // `draw` may run inside this very call (a free frame), before the ticket is back: it is then no longer waiting.
      let ran = false;
      const ticket = requestMark(() => {
        ran = true;
        waiting.delete(key);
        draw();
      });
      if (!ran) waiting.set(key, ticket);
    },
    cancel(key) {
      waiting.get(key)?.cancel();
      waiting.delete(key);
    },
  };
}

// The live session's steps still running for the quit (#205, #211): start requests awaiting their
// answer, the farewells and the enders. A step that throws is logged without its text, which could
// hold a token (log-lines.ts).
import { failedLine } from "./log-lines.ts";

export interface InFlight {
  /** Keeps `p` until it settles; a rejection is logged as one fixed line and the error's kind. */
  track(p: Promise<unknown>): void;
  /** Whether any step is still running. */
  busy(): boolean;
  /** Resolves once none is left, including those tracked while waiting. Never rejects. */
  settled(): Promise<void>;
}

export function createInFlight(log: (line: string) => void): InFlight {
  const running = new Set<Promise<unknown>>();
  return {
    track(p) {
      const done = (): void => void running.delete(p);
      running.add(p);
      p.then(done, (e: unknown) => {
        done();
        log(failedLine(e));
      });
    },
    busy: () => running.size > 0,
    async settled() {
      // An answer that comes while waiting may start an ender: it is tracked before the answer's own promise settles.
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}

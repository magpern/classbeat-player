// The Screen Wake Lock and Fullscreen at the edge (ADR 0008, section 5). The decisions are in
// wake-policy.ts; this file only talks to the browser. A refusal, or a browser with no wake lock,
// is reported once per request and never stops the class.

interface Sentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}
interface WakeLockApi {
  request(type: "screen"): Promise<Sentinel>;
}

export interface Wake {
  /** Asks for the lock unless this page holds one. Reports whether the request was refused. */
  ask(): void;
  /** Lets go of the lock, if held. A request still pending is let go of when it answers. */
  release(): void;
}

export function createWake(onRefused: (refused: boolean) => void): Wake {
  let sentinel: Sentinel | null = null;
  // Each ask and each release makes a new turn; an answer from an older turn is let go of at once.
  let turn = 0;
  const api = (): WakeLockApi | undefined => (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return {
    ask() {
      if (sentinel !== null && !sentinel.released) return;
      const mine = (turn += 1);
      const lock = api();
      if (!lock) return onRefused(true);
      lock.request("screen").then(
        (s) => {
          if (mine !== turn) return void s.release().catch(() => undefined);
          sentinel = s;
          s.addEventListener("release", () => {
            if (sentinel === s) sentinel = null;
          });
          onRefused(false);
        },
        () => {
          if (mine === turn) onRefused(true);
        },
      );
    },
    release() {
      turn += 1;
      const s = sentinel;
      sentinel = null;
      if (s !== null && !s.released) void s.release().catch(() => undefined);
    },
  };
}

/** Full screen where the browser has it (Start is a tap, which the Fullscreen API needs); nothing, and nothing said, where it has not (an iPhone). */
export function enterFullscreen(): void {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen().catch(() => undefined);
}

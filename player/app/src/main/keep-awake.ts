// One display-sleep blocker, held exactly while the policy says yes. Never stacked, stopped on
// every change to no and on quit. The blocker is injected (electron-blocker.ts is the Electron side).
import { mustKeepAwake } from "../core/awake/keep-awake-policy.ts";
import type { ClockView } from "../core/clock/view.ts";

export interface Blocker {
  start(type: "prevent-display-sleep"): number;
  stop(id: number): void;
}

export interface KeepAwake {
  /** Called with the clock's view on every snapshot; null when no class is open. */
  update(view: ClockView | null): void;
  /** Stops the blocker if one is held (quit, presenter closed). */
  release(): void;
}

export function createKeepAwake(blocker: Blocker): KeepAwake {
  let id: number | null = null;
  const release = (): void => {
    if (id === null) return;
    const held = id;
    id = null;
    blocker.stop(held);
  };
  return {
    update(view) {
      if (!mustKeepAwake(view)) release();
      else if (id === null) id = blocker.start("prevent-display-sleep");
    },
    release,
  };
}

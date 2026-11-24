// The join's controller: when the room window shows the scene and when it shows the plain 2D screen
// (scene.md "Motion and reduced motion", "Quality levels"; S10, S11). Everything it touches is a port
// the host hands it, so a fake failure can be driven in a test with no browser. The plain screen is
// never torn down: it keeps drawing from the same frames underneath, so when the scene is killed the
// class clock it shows is already the current one (continuous), and the switch is one `show("plain")`.
import type { JoinFrame } from "./room-feed-calc.ts";
import { feedOf } from "./room-feed-calc.ts";
import type { Feed } from "../src/loop.ts";
import type { TextClass } from "../src/text-types.ts";

/** What the host draws a scene frame with. `frame` may throw: that is a kill. */
export interface SceneHandle {
  frame(input: { readonly feed: Feed; readonly text: TextClass }, nowMs: number): void;
  dispose(): void;
}

export interface JoinPorts {
  /** Monotonic ms, the same clock `schedule` hands its callback. */
  now(): number;
  schedule(callback: (nowMs: number) => void): () => void;
  later(run: () => void, ms: number): () => void;
  /** Builds the scene on the host's canvas; throws where there is no WebGL. `onLost` is called when its context is lost. */
  create(onLost: () => void): SceneHandle;
  show(mode: "scene" | "plain"): void;
  /** False while the window is hidden or minimised (no frames are expected then). */
  visible(): boolean;
}

export interface JoinOptions {
  readonly reducedMotion: boolean;
  /** The presenter preview and CI's reduced screenshots: the scene is shown as the still rig instead of giving way to the plain screen. */
  readonly stillRig?: boolean;
}

/** A killed scene shows the plain screen within 2 s (S10): the watchdog looks every 500 ms and gives up on a frame that is 1.2 s late, so at most 1.7 s pass. */
export const WATCH_EVERY_MS = 500;
export const STALL_MS = 1200;

export type JoinMode = "scene" | "plain";

export interface Join {
  push(frame: JoinFrame): void;
  readonly mode: JoinMode;
  /** Why the scene is not shown, for the host's log: null while it is or before it was asked for. */
  readonly why: string | null;
  stop(): void;
}

export function startJoin(ports: JoinPorts, options: JoinOptions): Join {
  let latest: { readonly frame: JoinFrame; readonly at: number } | null = null;
  let mode: JoinMode = "plain";
  let why: string | null = null;
  let handle: SceneHandle | null = null;
  let cancelTick: (() => void) | null = null;
  let cancelWatch: (() => void) | null = null;

  const set = (next: JoinMode): void => {
    if (next === mode) return;
    mode = next;
    ports.show(next);
  };
  /** The scene is gone for the rest of this window: it does not come back (scene.md, Plain). */
  const kill = (reason: string): void => {
    why = reason;
    cancelTick?.();
    cancelWatch?.();
    const gone = handle;
    handle = null;
    set("plain");
    try { gone?.dispose(); } catch { /* the plain screen is already showing; a failed dispose has nothing left to lose */ }
  };

  const still = options.stillRig === true;
  const reducedMotion = options.reducedMotion || still;
  if (options.reducedMotion && !still) {
    why = "reduced motion";
  } else {
    try {
      handle = ports.create(() => kill("context lost"));
    } catch {
      why = "no WebGL";
    }
  }

  let lastFrameAt = ports.now();
  if (handle !== null) {
    const tick = (nowMs: number): void => {
      if (handle === null) return;
      const pack = latest === null ? null : feedOf(latest.frame, nowMs - latest.at, reducedMotion);
      if (pack === null) {
        set("plain");
      } else {
        try {
          handle.frame(pack, nowMs);
        } catch {
          kill("renderer error");
          return;
        }
        set("scene");
      }
      lastFrameAt = ports.now();
      cancelTick = ports.schedule(tick);
    };
    cancelTick = ports.schedule(tick);
    const watch = (): void => {
      if (handle === null) return;
      // A window nobody can see gets no animation frames from the browser: that is not a failure.
      if (!ports.visible()) lastFrameAt = ports.now();
      else if (ports.now() - lastFrameAt > STALL_MS) { kill("no frames"); return; }
      cancelWatch = ports.later(watch, WATCH_EVERY_MS);
    };
    cancelWatch = ports.later(watch, WATCH_EVERY_MS);
  }

  return {
    push(frame) { latest = { frame, at: ports.now() }; },
    get mode() { return mode; },
    get why() { return why; },
    stop() { kill("stopped"); },
  };
}

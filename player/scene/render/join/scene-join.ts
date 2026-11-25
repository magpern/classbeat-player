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

/** The class a frame is of, and whether it is a fresh start of it: a scene given up on stays down for the rest of that class (scene.md, Plain: "does not come back in that class") and is tried again for the next. */
const classKey = (f: JoinFrame): string => (f.doc === null ? "" : `${f.doc.class.title}|${f.doc.class.length_ms}|${f.doc.intervals.length}|${f.doc.songs.length}`);

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
  /** The class and run state the scene was given up on in; null while it runs or was never asked for. */
  let downIn: { readonly key: string; readonly ready: boolean } | null = null;
  let lastFrameAt = ports.now();
  let stopped = false;

  const set = (next: JoinMode): void => {
    if (next === mode) return;
    mode = next;
    ports.show(next);
  };
  const kill = (reason: string): void => {
    why = reason;
    cancelTick?.();
    cancelWatch?.();
    const gone = handle;
    handle = null;
    const f = latest?.frame ?? null;
    downIn = { key: f === null ? "" : classKey(f), ready: f?.view?.status === "ready" };
    set("plain");
    try { gone?.dispose(); } catch { /* the plain screen is already showing; a failed dispose has nothing left to lose */ }
  };

  const still = options.stillRig === true;
  const reducedMotion = options.reducedMotion || still;

  const boot = (): void => {
    try {
      handle = ports.create(() => kill("context lost"));
    } catch {
      why = "no WebGL";
      const f = latest?.frame ?? null;
      downIn = { key: f === null ? "" : classKey(f), ready: f?.view?.status === "ready" };
      return;
    }
    why = null;
    downIn = null;
    lastFrameAt = ports.now();
    const tick = (nowMs: number): void => {
      if (handle === null) return;
      try {
        // The feed too: a frame the join cannot read is a failure of the scene, not a stalled loop.
        const pack = latest === null ? null : feedOf(latest.frame, nowMs - latest.at, reducedMotion);
        if (pack === null) {
          set("plain");
        } else {
          handle.frame(pack, nowMs);
          set("scene");
        }
      } catch {
        kill("renderer error");
        return;
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
  };

  if (options.reducedMotion && !still) why = "reduced motion";
  else boot();

  return {
    push(frame) {
      latest = { frame, at: ports.now() };
      // A new class, or a fresh run of it, is another chance for a scene that was given up on (never with reduced motion).
      if (!stopped && downIn !== null && !(options.reducedMotion && !still) && handle === null && frame.view !== null && (classKey(frame) !== downIn.key || (frame.view.status === "ready" && !downIn.ready))) boot();
    },
    get mode() { return mode; },
    get why() { return why; },
    stop() { stopped = true; kill("stopped"); },
  };
}

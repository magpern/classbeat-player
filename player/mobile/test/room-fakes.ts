// Shared fakes for the room screen's tests (issue #871): a valid class of the format's examples, a
// fake clock and timer, and a fake native side that answers getClass. No network, no device.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClockRoom } from "../src/room/clock-room.ts";
import type { OpenRoomDeps } from "../src/room/open-room.ts";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schema", "class-format", "v1", "examples");

export const ID = "0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0";

/** A valid class document, as native code parses the saved text into {document}. */
export const classDoc = (): Record<string, unknown> => JSON.parse(readFileSync(join(EXAMPLES, "valid", "class-45min-crossfade-9s.json"), "utf8"));

export interface Harness {
  deps: OpenRoomDeps;
  /** Moves fake time on, running the push timer at each of its due times. */
  tick(ms: number): void;
  asked: unknown[];
  installed: ClockRoom[];
  mounted: number;
  went: string[];
  left: number;
  /** The room in `window.room` when the room screen's module was loaded. */
  roomAtMount: (ClockRoom | null)[];
  /** How many push timers are running. */
  timers(): number;
  /** Closes the page (pagehide). */
  close(): void;
  /** What loading the room screen's module gives: it loads by default. */
  mountResult: () => Promise<unknown>;
}

export function harness(answer: (args: unknown) => Promise<unknown>, search = `?id=${ID}`): Harness {
  let t = 1000;
  const timers: { fn: () => void; ms: number; due: number }[] = [];
  const closers: (() => void)[] = [];
  const h: Harness = {
    asked: [],
    installed: [],
    mounted: 0,
    went: [],
    left: 0,
    roomAtMount: [],
    timers: () => timers.length,
    close: () => closers.splice(0).forEach((fn) => fn()),
    mountResult: () => Promise.resolve(),
    tick(ms) {
      const end = t + ms;
      for (;;) {
        const next = timers.reduce<(typeof timers)[number] | null>((a, x) => (x.due <= end && (a === null || x.due < a.due) ? x : a), null);
        if (next === null) break;
        t = next.due;
        next.due += next.ms;
        next.fn();
      }
      t = end;
    },
    deps: {
      search,
      native: {
        getClass: (args) => {
          h.asked.push(args);
          return answer(args);
        },
      },
      now: () => t,
      every: (fn, ms) => {
        const timer = { fn, ms, due: t + ms };
        timers.push(timer);
        return () => {
          const at = timers.indexOf(timer);
          if (at >= 0) timers.splice(at, 1);
        };
      },
      onClose: (fn) => void closers.push(fn),
      leave: () => void (h.left += 1),
      install: (room) => void h.installed.push(room),
      mount: () => {
        h.mounted += 1;
        h.roomAtMount.push(h.installed.at(-1) ?? null);
        return h.mountResult();
      },
      go: (href) => void h.went.push(href),
    },
  };
  return h;
}

// The harness page's driver for the flash-budget checks (S6): a class played through the real room
// screen on a clock the check steps by frames, with a snapshot at every frame. The page's own timers are
// not used, so a run is exact and repeatable. `advance` stops at the first frame in which anything on the
// page changed, so the check can read that frame and no other (nothing changes between frames: there is no
// transition, animation or frame loop, and the checks say so).
import { createTimeline } from "./fixtures/timeline.ts";
import type { Scenario, Timeline } from "./fixtures/timeline.ts";
import { FRAME_MS } from "./room/mark-gate.ts";
import { mountRoom } from "./room/mount.ts";
import type { RoomClock, RoomScreen } from "./room/mount.ts";

export interface FrameStop {
  readonly frame: number;
  readonly ms: number;
}

export interface Drive {
  /** Mounts the room on `scenario` at frame 0; `reduced` is the player's own setting. */
  begin(scenario: Scenario, reduced: boolean): void;
  /** Forget the changes so far (the first draw, the fonts arriving). */
  reset(): void;
  /** Steps frames up to `lastFrame`; stops at the first frame in which the page changed, or returns null at the end. */
  advance(lastFrame: number): FrameStop | null;
  /** What on the page transitions, animates or is moved by the Web Animations API now. */
  moving(): string[];
}

export function createDrive(host: HTMLElement): Drive {
  let screen: RoomScreen | null = null;
  let timeline: Timeline | null = null;
  let frame = 0;
  let now = 0;
  let timers: { id: number; at: number; run: () => void }[] = [];
  let next = 0;
  const changes = new MutationObserver(() => undefined);
  changes.observe(host, { childList: true, attributes: true, characterData: true, subtree: true });
  const clock: RoomClock = {
    now: () => now,
    later: (run, delayMs) => {
      timers.push({ id: ++next, at: now + delayMs, run });
      return next;
    },
    cancel: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };

  return {
    begin(scenario, reduced) {
      screen?.destroy();
      [frame, now, timers] = [0, 0, []];
      timeline = createTimeline(scenario);
      screen = mountRoom(host, { reducedMotion: reduced, clock });
      screen.update(timeline.inputAt(0));
      changes.takeRecords();
    },
    reset() {
      changes.takeRecords();
    },
    advance(lastFrame) {
      if (!screen || !timeline) throw new Error("begin first");
      while (frame < lastFrame) {
        frame += 1;
        now = frame * FRAME_MS;
        for (let due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]; due; due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]) {
          timers = timers.filter((t) => t !== due);
          due.run();
        }
        screen.update(timeline.inputAt(now));
        if (changes.takeRecords().length > 0) return { frame, ms: now };
      }
      return null;
    },
    moving() {
      const found = [...host.querySelectorAll("*")].filter((e) => {
        const c = getComputedStyle(e);
        return c.transitionDuration.split(",").some((d) => parseFloat(d) > 0) || (c.animationName !== "none" && c.animationDuration.split(",").some((d) => parseFloat(d) > 0));
      });
      return [...found.map((e) => String(e.className || e.tagName)), ...document.getAnimations().map(() => "a Web Animation")];
    },
  };
}

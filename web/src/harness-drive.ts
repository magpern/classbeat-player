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
  /**
   * Mounts the room on `scenario` at frame 0; `reduced` is the player's own setting. `outside` are the times (ms) at which
   * the shell changes something on top of the screen, as the control band does: each toggles a bright block in the top right
   * corner (one change in one frame). They are drawn through `RoomScreen.requestMark`, or, with `bypass`, at once and with
   * no mark asked for (the negative control of the whole-room gate).
   */
  begin(scenario: Scenario, reduced: boolean, outside?: readonly number[], bypass?: boolean): void;
  /** Forget the changes so far (the first draw, the fonts arriving). */
  reset(): void;
  /** Steps frames up to `lastFrame`; stops at the first frame in which the page changed, or returns null at the end. */
  advance(lastFrame: number): FrameStop | null;
  /** Two outside changes due in one frame, the first throws: whether the second was drawn, and whether a third, asked for after, still is. */
  probeThrow(): Promise<{ thrown: boolean; second: boolean; third: boolean }>;
  /** What on the page transitions, animates or is moved by the Web Animations API now. */
  moving(): string[];
}

export function createDrive(host: HTMLElement): Drive {
  let screen: RoomScreen | null = null;
  let timeline: Timeline | null = null;
  let frame = 0;
  let now = 0;
  let timers: { id: number; at: number; run: () => void }[] = [];
  let requests: number[] = [];
  let bypassed = false;
  let block: HTMLElement | null = null;
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
    begin(scenario, reduced, outside = [], bypass = false) {
      screen?.destroy();
      block?.remove();
      block = document.createElement("div");
      block.style.cssText = "position:fixed;right:0;top:0;width:30vw;height:30vh;background:#fff;z-index:9;display:none";
      host.append(block);
      [frame, now, timers, requests, bypassed] = [0, 0, [], [...outside].sort((a, b) => a - b), bypass];
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
        while (requests.length > 0 && requests[0] <= now) {
          requests.shift();
          const toggle = (): void => {
            if (block) block.style.display = block.style.display === "none" ? "block" : "none";
          };
          if (bypassed) toggle();
          else screen.requestMark(toggle);
        }
        screen.update(timeline.inputAt(now));
        if (changes.takeRecords().length > 0) return { frame, ms: now };
      }
      return null;
    },
    async probeThrow() {
      if (!screen) throw new Error("begin first");
      const ran = { second: false, third: false };
      let thrown = false;
      const onError = (e: ErrorEvent): void => {
        thrown = true;
        e.preventDefault();
      };
      window.addEventListener("error", onError);
      screen.requestMark(() => {
        throw new Error("a draw that fails");
      });
      screen.requestMark(() => {
        ran.second = true;
      });
      this.advance(frame + 90);
      await Promise.resolve();
      screen.requestMark(() => {
        ran.third = true;
      });
      this.advance(frame + 90);
      await Promise.resolve();
      window.removeEventListener("error", onError);
      return { thrown, ...ran };
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

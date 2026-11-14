// A class on the screen: the room screen on the manual clock, its band and keys, keep-awake and
// full screen (ADR 0008, sections 4 and 5). The decisions are in the pure modules (session.ts,
// wake-policy.ts, band-model.ts, keys.ts); this file owns the page's timers and events. From Start
// to the end of the class it sends no request of any kind: every asset was loaded before.
import type { Status } from "../../../player/app/src/core/clock/clock.ts";
import type { Class } from "../room/input.ts";
import { mountRoom } from "../room/mount.ts";
import { scaleFor } from "../room/score-scale.ts";
import { mountBand } from "./band.ts";
import { attachKeys } from "./keyboard.ts";
import { roomInput } from "./room-input.ts";
import { advance, apply, openClass, statusOf, viewOf } from "./session.ts";
import type { Command, Session } from "./session.ts";
import { createWake, enterFullscreen } from "./wake.ts";
import { noticeOf, wakeAction } from "./wake-policy.ts";
import type { WakeEvent } from "./wake-policy.ts";

export interface PlayerOptions {
  /** The page was reloaded during a class: the notice "Reloaded: back to the start" shows until Start. */
  readonly reloaded: boolean;
  /** End class and Close class: the class leaves memory and the picker shows. */
  readonly onEnd: () => void;
}

export interface Player {
  destroy(): void;
}

/** How often a running clock redraws (the countdown moves in whole seconds). */
const REDRAW_MS = 200;

export function openPlayer(doc: Class, o: PlayerOptions): Player {
  const now = (): number => performance.now();
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const room = mountRoom(document.body, { reducedMotion, scale: () => scaleFor(window.innerWidth, window.innerHeight) });
  const root = document.querySelector<HTMLElement>(".room") ?? document.body;

  let session: Session = openClass(doc, now());
  let reloaded = o.reloaded;
  let wakeRefused = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let destroyed = false;

  const wake = createWake((refused) => {
    if (destroyed || wakeRefused === refused) return;
    wakeRefused = refused;
    draw();
  });
  const wakeFor = (event: WakeEvent): void => {
    const action = wakeAction(event, statusOf(session));
    if (action === "ask") wake.ask();
    else if (action === "release") wake.release();
  };

  function draw(): void {
    const view = viewOf(session, now());
    room.update(roomInput(doc, view, noticeOf(view.status, reloaded, wakeRefused)));
    band.status(view.status);
  }

  /** A running clock redraws every REDRAW_MS and holds at the class end; any other state needs no timer. */
  function pace(): void {
    clearInterval(timer);
    if (statusOf(session) !== "running") return;
    timer = setInterval(() => {
      const before = statusOf(session);
      session = advance(session, now());
      if (before !== "ended" && statusOf(session) === "ended") settle(before);
      draw();
    }, REDRAW_MS);
  }

  /** The clock changed state: the lock and the timer follow. */
  function settle(before: Status): void {
    const after = statusOf(session);
    if (after === "ended") {
      wake.release();
      wakeRefused = false;
    }
    if (before === "ready" && after !== "ready") reloaded = false;
    pace();
  }

  const band = mountBand(root, { command, endClass: end }, { reducedMotion });

  function command(c: Command): void {
    const before = statusOf(session);
    session = apply(session, c, now());
    if (c === "start" && before === "ready") {
      // Start is a tap or a key: the one moment full screen and the lock may be asked for.
      enterFullscreen();
      wakeFor("start");
    } else if (c === "resume") wakeFor("resume");
    settle(before);
    draw();
  }

  function end(): void {
    o.onEnd();
  }

  const stopKeys = attachKeys(band);
  const onVisibility = (): void => wakeFor(document.hidden ? "hidden" : "shown");
  const onResize = (): void => draw();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  draw();

  return {
    destroy() {
      destroyed = true;
      clearInterval(timer);
      wake.release();
      stopKeys();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      band.destroy();
      room.destroy();
    },
  };
}

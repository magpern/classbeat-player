// The room screen's options on the phone (issue #871; docs/design/play.md, "Sizes" and "The score on
// small screens"). Pure. Held upright, the phone gets /play's portrait scale (three minutes across)
// and /play's text fitting; on its side it passes no scale, which is exactly what the desktop's room
// window passes, so that layout is the room screen as it was. mountRoom (web/src/room/mount.ts) reads
// `scale` afresh at every fit and frame, so the getter follows the phone as it turns.
import type { RoomOptions } from "../../../../web/src/room/mount.ts";
import { layoutOf, scaleFor } from "../../../../web/src/room/score-scale.ts";

/** The media query of play.md's Portrait layout: as tall as wide or taller (layoutOf's rule). */
export const PORTRAIT = "(max-aspect-ratio: 1/1)";

export interface Viewport {
  readonly innerWidth: number;
  readonly innerHeight: number;
}

/** [opts] with a `scale` that is /play's while [view] is portrait and absent otherwise. */
export function phoneRoomOptions(opts: RoomOptions | undefined, view: Viewport): RoomOptions {
  const scale = () => scaleFor(view.innerWidth, view.innerHeight);
  const portrait = (): boolean => layoutOf(view.innerWidth, view.innerHeight) === "portrait";
  return Object.defineProperty({ ...opts }, "scale", { enumerable: true, get: () => (portrait() ? scale : undefined) });
}

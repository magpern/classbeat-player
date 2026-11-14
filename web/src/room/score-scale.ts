// The score's scale per layout (docs/design/play.md, "The score on small screens"). Pure: the
// layout and the numbers that follow from it, from the size of the screen alone.
//
// The room window of the player only ever uses `LANDSCAPE_SCALE` (six minutes across). The web
// player page chooses between three layouts by the viewport: the room's own, a phone on its side,
// and portrait (three minutes across, so a 30-second interval is not 16 px wide at 390 px).

export type Layout = "room" | "small-landscape" | "portrait";

export interface ScoreScale {
  /** vw per second of class time: 0.28 across six minutes, 0.56 across three. */
  readonly vwPerS: number;
  /** A block needs at least this much room ahead of "now" for its number (the sliver rule). */
  readonly minBlockW: number;
  /** A block that begins right of this has no room for its number inside the safe edge. */
  readonly numberFitsUntil: number;
  /** The right safe edge, in vw: a label that would cross it is kept inside. */
  readonly safeRight: number;
  /** A moment's label is offered only left of this. */
  readonly momentUntil: number;
}

/** The room screen's own scale (room-2d.md): six minutes across, 90 s behind "now", 4:30 ahead. */
export const LANDSCAPE_SCALE: ScoreScale = { vwPerS: 100 / 360, minBlockW: 3, numberFitsUntil: 91, safeRight: 95, momentUntil: 80 };

/** The layout for a viewport (play.md, "Sizes"): chosen from the viewport alone. */
export function layoutOf(width: number, height: number): Layout {
  if (width <= height) return "portrait";
  return height < 720 ? "small-landscape" : "room";
}

/** The block number's size on the phone layouts, as a share of the viewport height (the minor tier). */
const MINOR_VH = { portrait: 3.1, "small-landscape": 5.5 } as const;
/** The room's padding inside a block. */
const PAD = 0.8;

/** The score's scale for a viewport. Portrait shows three minutes: 45 s behind "now", 2:15 ahead. */
export function scaleFor(width: number, height: number): ScoreScale {
  const layout = layoutOf(width, height);
  if (layout === "room" || width <= 0 || height <= 0) return LANDSCAPE_SCALE;
  // 1.1 em of the block number, in vw: a number is never squeezed into a sliver narrower than itself.
  const number = (1.1 * MINOR_VH[layout] * height) / width;
  const safeRight = 96;
  return {
    vwPerS: layout === "portrait" ? 100 / 180 : 100 / 360,
    minBlockW: Math.max(3, Math.round(number * 100) / 100),
    numberFitsUntil: Math.round((safeRight - PAD - number) * 100) / 100,
    safeRight,
    momentUntil: layout === "portrait" ? 66 : 80,
  };
}

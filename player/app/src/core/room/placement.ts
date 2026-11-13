// Where the room screen's window goes when a class opens (docs/design/class-list.md: Start opens
// the room screen in its own window, the presenter keeps this one). Pure: the shell passes plain
// facts about the displays and the presenter window.
//
// - The display the instructor last moved the room window to, while it is still there and is not
//   the presenter's: full screen on it.
// - Otherwise another display than the presenter's (the largest; the first of equals): full screen.
// - With only one display: a 16:9 rehearsal window in the largest free part of the work area
//   beside, below or above the presenter, never overlapping it, so the presenter keeps its place
//   and every control stays clear. Where no free part has room for the minimum, the window has the
//   minimum size and the shell keeps the presenter above it (`behindPresenter`): the presenter and
//   its controls are never covered.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DisplayFacts {
  readonly id: number;
  readonly bounds: Rect;
  /** The part of the display windows may use (without task bars and menu bars). */
  readonly workArea: Rect;
}

export interface RoomPlacement {
  readonly displayId: number;
  /** The window's outer bounds: the whole display when full screen. */
  readonly bounds: Rect;
  readonly fullScreen: boolean;
  /** No free room beside the presenter: the shell raises the presenter above the room window. */
  readonly behindPresenter: boolean;
}

/** The room window on the presenter's own display: never wider than this. */
export const SHARED_MAX_WIDTH = 1280;
/** Nor narrower than the presenter's own preview at its smallest (room-2d.md, 480×270), where it fits. */
export const SHARED_MIN_WIDTH = 480;

const area = (r: { readonly width: number; readonly height: number }): number => r.width * r.height;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The largest 16:9 size, at most SHARED_MAX_WIDTH wide, that fits in w × h. */
function fit(w: number, h: number, max = SHARED_MAX_WIDTH): { width: number; height: number } {
  const width = Math.max(0, Math.min(max, Math.floor(w), Math.floor((h * 16) / 9)));
  return { width, height: Math.min(Math.floor(h), Math.round((width * 9) / 16)) };
}

/** The free parts of the work area around the presenter: right, left, below, above (the order of preference among equals). */
function freeParts(wa: Rect, p: Rect): Rect[] {
  const waRight = wa.x + wa.width;
  const waBottom = wa.y + wa.height;
  const pRight = clamp(p.x + p.width, wa.x, waRight);
  const pLeft = clamp(p.x, wa.x, waRight);
  const pBottom = clamp(p.y + p.height, wa.y, waBottom);
  const pTop = clamp(p.y, wa.y, waBottom);
  return [
    { x: pRight, y: wa.y, width: waRight - pRight, height: wa.height },
    { x: wa.x, y: wa.y, width: pLeft - wa.x, height: wa.height },
    { x: wa.x, y: pBottom, width: wa.width, height: waBottom - pBottom },
    { x: wa.x, y: wa.y, width: wa.width, height: pTop - wa.y },
  ];
}

/** The window in one free part: at the part's far edge from the presenter, level with the presenter where it fits. */
function inPart(part: Rect, index: number, p: Rect, size: { width: number; height: number }): Rect {
  const sideways = index < 2;
  const x = sideways ? (index === 0 ? part.x + part.width - size.width : part.x) : clamp(p.x, part.x, part.x + part.width - size.width);
  const y = sideways ? clamp(p.y, part.y, part.y + part.height - size.height) : index === 2 ? part.y + part.height - size.height : part.y;
  return { x, y, ...size };
}

function shared(wa: Rect, p: Rect): { bounds: Rect; behindPresenter: boolean } {
  const parts = freeParts(wa, p);
  let best = -1;
  let bestSize = { width: 0, height: 0 };
  parts.forEach((part, i) => {
    const size = fit(part.width, part.height);
    if (area(size) > area(bestSize)) [best, bestSize] = [i, size];
  });
  if (best >= 0 && bestSize.width >= SHARED_MIN_WIDTH) return { bounds: inPart(parts[best], best, p, bestSize), behindPresenter: false };
  // No free part has room: the minimum (or as large as the work area allows), on the side with
  // more room, under the presenter.
  const size = fit(wa.width, wa.height, SHARED_MIN_WIDTH);
  const side = parts[0].width >= parts[1].width ? 0 : 1;
  return { bounds: inPart(wa, side, p, size), behindPresenter: true };
}

/** Null only when the system reports no display at all. */
export function placeRoom(displays: readonly DisplayFacts[], presenterDisplayId: number | null, presenter: Rect | null, preferredId: number | null): RoomPlacement | null {
  if (displays.length === 0) return null;
  const others = displays.filter((d) => d.id !== presenterDisplayId);
  const preferred = others.find((d) => d.id === preferredId);
  const largest = others.reduce<DisplayFacts | null>((best, d) => (best === null || area(d.bounds) > area(best.bounds) ? d : best), null);
  const target = preferred ?? largest;
  if (target) return { displayId: target.id, bounds: target.bounds, fullScreen: true, behindPresenter: false };
  const own = displays.find((d) => d.id === presenterDisplayId) ?? displays[0];
  const p = presenter ?? { x: own.workArea.x, y: own.workArea.y, width: 0, height: 0 };
  return { displayId: own.id, ...shared(own.workArea, p), fullScreen: false };
}

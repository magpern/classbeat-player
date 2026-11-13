// Where the room screen's window goes when a class opens (docs/design/class-list.md: Start opens
// the room screen in its own window, the presenter keeps this one). Pure: the shell passes plain
// facts about the displays and the presenter window.
//
// - The display the instructor last moved the room window to, while it is still there and is not
//   the presenter's: full screen on it.
// - Otherwise another display than the presenter's (the largest; the first of equals): full screen.
// - With only one display: a 16:9 window on it, beside the presenter where there is room, so the
//   presenter keeps its place and its controls.

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
}

/** The room window on the presenter's own display: never wider than this, nor narrower than the minimum, where it fits. */
export const SHARED_MAX_WIDTH = 1280;
export const SHARED_MIN_WIDTH = 640;

const area = (r: Rect): number => r.width * r.height;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function beside(wa: Rect, presenter: Rect): Rect {
  const right = wa.x + wa.width - (presenter.x + presenter.width);
  const left = presenter.x - wa.x;
  const free = Math.max(right, left);
  // Where neither side has room for the minimum, the window overlaps the presenter at the far edge.
  let width = Math.min(SHARED_MAX_WIDTH, wa.width, free >= SHARED_MIN_WIDTH ? free : SHARED_MIN_WIDTH);
  let height = Math.round((width * 9) / 16);
  if (height > wa.height) {
    height = wa.height;
    width = Math.round((height * 16) / 9);
  }
  const onRight = right >= left;
  const x = onRight ? wa.x + wa.width - width : wa.x;
  const y = clamp(presenter.y, wa.y, wa.y + wa.height - height);
  return { x, y, width, height };
}

/** Null only when the system reports no display at all. */
export function placeRoom(displays: readonly DisplayFacts[], presenterDisplayId: number | null, presenter: Rect | null, preferredId: number | null): RoomPlacement | null {
  if (displays.length === 0) return null;
  const others = displays.filter((d) => d.id !== presenterDisplayId);
  const preferred = others.find((d) => d.id === preferredId);
  const largest = others.reduce<DisplayFacts | null>((best, d) => (best === null || area(d.bounds) > area(best.bounds) ? d : best), null);
  const target = preferred ?? largest;
  if (target) return { displayId: target.id, bounds: target.bounds, fullScreen: true };
  const own = displays.find((d) => d.id === presenterDisplayId) ?? displays[0];
  const p = presenter ?? { x: own.workArea.x, y: own.workArea.y, width: 0, height: 0 };
  return { displayId: own.id, bounds: beside(own.workArea, p), fullScreen: false };
}

/**
 * Whether the room window closes now. The class is closed once the instructor is on the class list
 * with no class pinned: a pinned class can be gone back to ("Back to the class"), a class that has
 * ended or came from a file cannot. While the presenter shows, the room stays, on "Class Complete"
 * after the end.
 */
export const roomCloses = (onList: boolean, pinned: boolean): boolean => onList && !pinned;

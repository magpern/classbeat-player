// Where the room screen's window goes when a class opens (docs/design/class-list.md, "Where the
// room window goes"). Pure: the shell passes plain facts about the displays and the presenter window.
//
// - The display the instructor last moved the room window to, while it is still there and is not
//   the presenter's: full screen on it.
// - Otherwise another display than the presenter's (the largest; the first of equals): full screen.
// - With only one display (plan section 3, "One screen first", owner 2026-11-13): full screen on
//   it, above the presenter (`alone`). The class runs from the room screen's own controls, and
//   End or Close class brings the presenter back. This replaces the earlier rule of a 16:9 window
//   beside the presenter, under which the room window could hide the presenter's Start.

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
  /** The window's outer bounds: the whole display. */
  readonly bounds: Rect;
  readonly fullScreen: true;
  /** On the presenter's own display, the only one: the room window goes above the presenter and takes the keyboard if the application has it. */
  readonly alone: boolean;
}

const area = (r: { readonly width: number; readonly height: number }): number => r.width * r.height;

/** Null only when the system reports no display at all. */
export function placeRoom(displays: readonly DisplayFacts[], presenterDisplayId: number | null, preferredId: number | null): RoomPlacement | null {
  if (displays.length === 0) return null;
  const others = displays.filter((d) => d.id !== presenterDisplayId);
  const preferred = others.find((d) => d.id === preferredId);
  const largest = others.reduce<DisplayFacts | null>((best, d) => (best === null || area(d.bounds) > area(best.bounds) ? d : best), null);
  const target = preferred ?? largest;
  if (target) return { displayId: target.id, bounds: target.bounds, fullScreen: true, alone: displays.length === 1 };
  const own = displays.find((d) => d.id === presenterDisplayId) ?? displays[0]!;
  return { displayId: own.id, bounds: own.bounds, fullScreen: true, alone: true };
}

// The cue's size and layout, decided by measuring (docs/design/room-2d.md, "Fitting text", "Cue").
// DOM at the edge: only the browser knows whether the glyphs of this cue fit its lines.
//
// The cue box holds two lines at --t-text; a longer cue (over 60 characters, or one that needs a
// third line) is set at --t-text-min, which holds three lines wider than 3:2 and two at 3:2 and
// narrower. A cue that needs more takes the next row's second line, the next cue, for that interval:
//   wider than 3:2:        a fourth line  -> `.four`
//   at 3:2 and narrower:   a third line   -> `.three` (the next row is one line),
//                          a fourth line  -> `.four` (the next row moves up beside the gel, short)

/** The cue's lines at the size now set. */
function linesOf(cue: HTMLElement): number {
  return Math.round(cue.scrollHeight / parseFloat(getComputedStyle(cue).lineHeight));
}

/**
 * `byLength`: the model set `.long` for a cue over 60 characters. `phone`: the web player page's
 * phone layouts give the cue all the height left, up to 120 characters with long words
 * (play.md, "Fitting text"): never cut, at most eight lines, none of the room's steps.
 */
export function fitCue(cue: HTMLElement | null, phone: boolean): void {
  if (!cue) return;
  const byLength = cue.dataset.byLength === "1";
  cue.classList.remove("three", "four");
  cue.classList.toggle("long", byLength);
  if (phone) {
    cue.dataset.lines = "8";
    return;
  }
  const narrow = typeof matchMedia === "function" && matchMedia("(max-aspect-ratio: 3/2)").matches;
  // Two lines do not hold it at --t-text: the smaller size.
  if (!byLength && linesOf(cue) > 2) cue.classList.add("long");
  const long = cue.classList.contains("long");
  const n = linesOf(cue);
  const holds = long ? (narrow ? 2 : 3) : 2;
  if (n > holds) cue.classList.add(narrow && n === 3 ? "three" : "four");
  cue.dataset.lines = String(cue.classList.contains("four") ? 4 : cue.classList.contains("three") ? 3 : holds);
}

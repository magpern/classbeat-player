// The fitting steps of companion.md ("Fitting text"): when the cue does not fit its box, the page
// takes these steps in order until it does. It never cuts the cue and never sets it smaller than
// `--c-text-min`.
// 1. Next rows: three, then two, then one.
// 2. tight: also the notice's detail line goes.
// 3. tighter, only for a cue written all in capitals: the next rows go.

const overflows = (cue: HTMLElement): boolean => cue.scrollHeight > cue.clientHeight + 1 || cue.scrollWidth > cue.clientWidth + 1;

/** A cue written all in capitals: letters, and none of them lower case. */
export const allCapitals = (text: string): boolean => /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);

export function fitCue(run: HTMLElement): void {
  run.classList.remove("tight", "tighter");
  const rows = [...run.querySelectorAll<HTMLElement>(".coming > .next")];
  for (const r of rows) {
    r.classList.remove("cut");
    (r.previousElementSibling as HTMLElement | null)?.classList.remove("cut");
  }
  const cue = run.querySelector<HTMLElement>(".cue");
  if (!cue || !cue.textContent) return;
  // Step 1: drop the last next row while more than one is left.
  for (let n = rows.length - 1; n > 0 && overflows(cue); n -= 1) {
    const r = rows[n];
    r.classList.add("cut");
    (r.previousElementSibling as HTMLElement | null)?.classList.add("cut");
  }
  if (!overflows(cue)) return;
  run.classList.add("tight");
  if (overflows(cue) && allCapitals(cue.textContent)) run.classList.add("tighter");
}

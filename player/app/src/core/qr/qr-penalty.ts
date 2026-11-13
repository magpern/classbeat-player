// The mask penalty score of ISO/IEC 18004 section 7.8.3: runs of one colour, 2x2 blocks,
// finder-like patterns and the dark/light balance. The encoder keeps the mask with the lowest
// score. Pure: no I/O.
import type { Grid } from "./qr-layout.ts";

const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** Pushes a run length onto the history of the last seven runs; the first run gets the light border. */
function addHistory(run: number, history: number[], size: number): void {
  if (history[0] === 0) run += size;
  history.pop();
  history.unshift(run);
}

/** How many 1:1:3:1:1 finder-like patterns, with 4 light modules on one side, end in this history. */
function finderLike(h: readonly number[]): number {
  const n = h[1];
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
  return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
}

/** The run and finder-pattern penalties of one line of modules. */
function linePenalty(line: readonly boolean[]): number {
  const size = line.length;
  let result = 0;
  let color = false;
  let run = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  for (const dark of line) {
    if (dark === color) {
      run++;
      if (run === 5) result += N1;
      else if (run > 5) result++;
    } else {
      addHistory(run, history, size);
      if (!color) result += finderLike(history) * N3;
      color = dark;
      run = 1;
    }
  }
  if (color) {
    addHistory(run, history, size);
    run = 0;
  }
  addHistory(run + size, history, size);
  return result + finderLike(history) * N3;
}

export function penalty(m: Grid): number {
  const size = m.length;
  let result = 0;
  for (let y = 0; y < size; y++) result += linePenalty(m[y]);
  for (let x = 0; x < size; x++) result += linePenalty(m.map((row) => row[x]));
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += N2;
    }
  }
  const dark = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return result + k * N4;
}

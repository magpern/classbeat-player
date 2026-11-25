// The scene's frame-rate log (docs/design/scene.md S9): once a second, the frame rate of the last second and the quality level it was
// drawn at. One fixed line per sample, written to the player's local log (the console, as the app's other log lines are); it holds
// no rider data, is never sent anywhere, and a log that fails never stops the scene.
import type { SecondRow } from "../../../scene/model/src/index.ts";

/** The fixed line for one sample: numbers and the level's name only. */
export const secondLine = (row: SecondRow): string => `scene frame rate: second=${row.second} fps=${row.fps} level=${row.level}`;

/** The `onSecond` the room window hands the scene's join: writes each sample and swallows a write that fails. */
export function frameRateLogger(write: (line: string) => void = (line) => console.info(line)): (row: SecondRow) => void {
  return (row) => {
    try { write(secondLine(row)); } catch { /* a failing log is no failure of the scene */ }
  };
}

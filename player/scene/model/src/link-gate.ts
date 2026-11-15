// What the link state allows the rig to do with the song's moments and bursts (scene.md "Moments
// at the None level"). Paused and a hold freeze the rig, and off the list the music is not the
// planned song, so its position says nothing about the planned song's moments. Pure.

import type { LinkInput } from "./beat-level.ts";
import { NO_MOMENTS, intervalBurst } from "./moments.ts";
import type { LightBurst, Moments } from "./moments.ts";

/** Paused and a hold freeze the rig where it was: nothing turns and nothing moves on. */
export function rigFrozen(link: LinkInput): boolean {
  return link.state === "Paused" || link.held === true;
}

/** Marked moments and light-only bursts run in every state but these three. */
export function momentsAllowed(link: LinkInput): boolean {
  return !rigFrozen(link) && link.state !== "Off the list";
}

/** The song's moments for the frame: none when the link state does not allow them. */
export function gatedMoments(link: LinkInput, moments: Moments): Moments {
  return momentsAllowed(link) ? moments : NO_MOMENTS;
}

/** `intervalBurst`, and none at all where moments are not allowed (off the list, paused, held). */
export function gatedBurst(
  link: LinkInput,
  songHasMoments: boolean,
  atIntervalChange: boolean,
  msSinceLastBurst: number | null,
): LightBurst | null {
  return momentsAllowed(link) ? intervalBurst(songHasMoments, atIntervalChange, msSinceLastBurst) : null;
}

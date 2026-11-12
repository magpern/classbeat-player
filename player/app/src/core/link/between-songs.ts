// What a music app reports while it changes from one song to the next, for every parser. Pure.
// Between two songs a music app may say for a moment that it is stopped, or that it plays
// something with neither a title nor an artist. Taken as it stands, that would show Paused or
// Off the list for one poll at every song change. A parser marks such an answer `between`; the
// lifecycle (reader-lifecycle.ts) then holds the reading it had for that one poll, and takes the
// answer as it stands only when the next one says the same.
import type { Answer } from "./reader-lifecycle.ts";
import type { Observation } from "./types.ts";

/** The music app is there with nothing loaded, as it also is for a moment between two songs. */
export const STOPPED: Answer = Object.freeze({ kind: "closed", between: true });

/** Playing, with neither a title nor an artist. */
export const namesNothing = (obs: Observation): boolean => obs.playing && obs.title === "" && obs.artist === "";

/** A reading as an answer, marked when it is what a music app reports between two songs. */
export function readingOf(obs: Observation, between = namesNothing(obs)): Answer {
  return between ? { kind: "reading", obs, between: true } : { kind: "reading", obs };
}

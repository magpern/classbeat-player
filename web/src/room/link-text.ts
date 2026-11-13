// The words for the music link and the clock's label (docs/design/room-2d.md, "States"). Pure.
// Link states are white, grey and black only, never a hue (rule 7): the look says how, never a zone.
import type { Class, LinkInput, RoomInput } from "./input.ts";
import type { LinkPlate } from "./model.ts";

type View = NonNullable<RoomInput["view"]>;

/** Link plates are at most about 20 characters so they fit beside the class time at 4:3. */
export function linkPlate(doc: Class, link: LinkInput | null, view: View, started: boolean): LinkPlate {
  if (!started) {
    return link?.mode === "following" ? { text: "Waiting for the first song", look: "quiet" } : { text: "Press Start", look: "manual" };
  }
  if (!link || link.mode === "manual" || link.state === "Manual") return { text: "Manual clock", look: "manual" };
  switch (link.state) {
    case "Paused":
      return { text: "Music paused", look: "alert" };
    case "Coasting":
      return { text: "Music not heard", look: "alert" };
    case "Off the list":
      return { text: "Not a class song", look: "alert" };
    case "Ambiguous":
      return { text: "Song is in twice", look: "alert" };
    default:
      return { text: followingText(doc), look: "quiet" };
  }
}

function followingText(doc: Class): string {
  if (doc.music.source === "spotify") return "Following Spotify";
  if (doc.music.source === "swedebeat") return "Following Swedebeat";
  return "Following the music";
}

/** The clock's label above the countdown; "estimated" says the clock only guesses. */
export function countLabel(opts: { held: boolean; lastInterval: boolean; remainingMs: number; guessing: boolean }): string {
  // The hold at a song change: the countdown is the expected time to the next song.
  if (opts.held) return "Until the next song";
  const base = opts.remainingMs <= 5000 && opts.remainingMs > 0 ? "Change in" : opts.lastInterval ? "Last interval" : "Interval left";
  return opts.guessing ? `${base}, estimated` : base;
}

/** What a pause says under the frozen countdown. */
export function pauseLine(link: LinkInput | null): string {
  return link?.mode === "following" ? "Starts again with the music" : "Starts again when resumed";
}

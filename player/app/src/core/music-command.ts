// The presenter's commands to the music app: play, pause and next, by name. Pure. They travel on
// the same IPC channel as the clock commands and pass the same kind of shape check: anything that
// is not exactly one of these three names is refused (null). No free text ever reaches a helper.
// The shell passes a name on to the music app's own controls (ADR 0001: "Start, pause and next go
// through the same local interface"); the player itself never plays anything (plan section 3,
// rule 3).
import { hasOnly, isPlainObject } from "./commands.ts";

export const MUSIC_ACTIONS = ["play", "pause", "next"] as const;
export type MusicAction = (typeof MUSIC_ACTIONS)[number];

export interface MusicCommand {
  readonly type: "music";
  readonly action: MusicAction;
}

export const isMusicAction = (v: unknown): v is MusicAction => typeof v === "string" && (MUSIC_ACTIONS as readonly string[]).includes(v);

export function parseMusicCommand(v: unknown): MusicCommand | null {
  if (!isPlainObject(v) || v.type !== "music" || !hasOnly(v, ["type", "action"])) return null;
  return isMusicAction(v.action) ? { type: "music", action: v.action } : null;
}

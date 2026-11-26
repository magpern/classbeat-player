// The room screen's way into native code for following the music (issue #872, app-follow.md): the
// access check, the setting, following on and off, the reading, and play, pause and next. The room
// page gets this and never instructor mode's whole plugin, so it can neither switch mode, list, sync
// nor unpair (modes.test.ts pins it). No intent takes an argument: nothing of the page goes native.
import type { InstructorModePlugin } from "../modes/bridge.ts";
import type { FollowIntents } from "../follow/android-reader.ts";

export interface RoomFollowSource extends FollowIntents {
  /** Whether Android has granted Notification access: {granted} (follow/answers.ts). */
  followAccess(): Promise<unknown>;
  /** Opens Android's Notification access list for this app. */
  openFollowSetting(): Promise<unknown>;
}

type FollowPlugin = Pick<InstructorModePlugin, "followAccess" | "openFollowSetting" | "follow" | "unfollow" | "reading" | "sendPlay" | "sendPause" | "sendNext">;

/** Narrows [plugin] to the eight follow intents, each called with no argument. */
export function roomFollowSource(plugin: FollowPlugin): RoomFollowSource {
  return Object.freeze({
    followAccess: () => plugin.followAccess(),
    openFollowSetting: () => plugin.openFollowSetting(),
    follow: () => plugin.follow(),
    unfollow: () => plugin.unfollow(),
    reading: () => plugin.reading(),
    sendPlay: () => plugin.sendPlay(),
    sendPause: () => plugin.sendPause(),
    sendNext: () => plugin.sendNext(),
  });
}

// The page's only calls into native code (ADR 0011 section 3, issue #630): each mode's plugin and
// its named intents, none taking an argument (getClass, the one that takes a class id, waits for
// the room screen to leave its fakes). Only the current mode's plugin is on the bridge, and
// native code checks every call again, so a call from the wrong mode is refused there, not here.
// Nothing here selects, changes or unlocks a mode: the page asks, and native code decides.
import { registerPlugin } from "@capacitor/core";

export interface RiderModePlugin {
  /** "pair" on an unpaired phone, "lock" on a paired one: the strip's lead line. */
  instructorWay(): Promise<unknown>;
  /** Starts the way into instructor mode. On a switch the page is replaced and this never settles. */
  askInstructorMode(): Promise<unknown>;
}

export interface InstructorModePlugin {
  /** Asks the native question "Switch to rider mode?". On a switch the page is replaced. */
  askRiderMode(): Promise<unknown>;
  /** The classes saved on this phone and the last sync's status: {classes, status} (issue #631). */
  listClasses(): Promise<unknown>;
  /** Syncs now with the paired account, then answers as listClasses. Native code makes the call. */
  syncNow(): Promise<unknown>;
  /**
   * Asks the native question "Unpair this phone?". On "Unpair" native code deletes the token and the
   * saved classes, gives the token back and leaves; on "Stay" it answers "stayed".
   */
  unpair(): Promise<unknown>;
  /** Opens the native pairing screen again once the pairing ran out. */
  pairAgain(): Promise<unknown>;
  // Following the music app (issue #632; follow/answers.ts reads the answers). Notification access
  // is asked for only through these, so only in instructor mode.
  /** Whether Android has granted the notification access following needs: {granted}. */
  followAccess(): Promise<unknown>;
  /** Opens Android's notification-access setting for this app: {state: "opened" | "notOpened"}. */
  openFollowSetting(): Promise<unknown>;
  /** Turns following on: {state: "following" | "noAccess" | "unavailable"}. */
  follow(): Promise<unknown>;
  /** Back to the manual clock: {state: "stopped"}. */
  unfollow(): Promise<unknown>;
  /** The latest reading while following, or why there is none. */
  reading(): Promise<unknown>;
}

export const riderMode = (): RiderModePlugin => registerPlugin<RiderModePlugin>("RiderMode");

export const instructorMode = (): InstructorModePlugin => registerPlugin<InstructorModePlugin>("InstructorMode");

// The page's only calls into native code (ADR 0011 section 3, issue #630): each mode's plugin and
// its named intents. Only two take arguments, each strings and nothing else (IntentPolicy.kt): rider
// mode's join, the class code and the nickname, and instructor mode's getClass, the class id the
// room screen opens (issue #871). No intent takes or answers the rider token: native code holds it. Only the current mode's plugin is on the bridge, and
// native code checks every call again, so a call from the wrong mode is refused there, not here.
// Nothing here selects, changes or unlocks a mode: the page asks, and native code decides.
import { Capacitor, registerPlugin } from "@capacitor/core";

/** "ios", "android" or "web": which web view this is, no native call (room/reader-platform.ts). */
export const platformName = (): string => Capacitor.getPlatform();

export interface RiderModePlugin {
  /** "pair" on an unpaired phone, "lock" on a paired one: the strip's lead line. */
  instructorWay(): Promise<unknown>;
  /** Starts the way into instructor mode. On a switch the page is replaced and this never settles. */
  askInstructorMode(): Promise<unknown>;
  /** Joins a class: {result: "joined"}, {result: "unreachable"} or {result: "answer", status, body} (native.ts). */
  join(args: { session: string; nickname: string }): Promise<unknown>;
  /** Opens the live link with the token native code holds; what comes in arrives through receive. */
  open(): Promise<unknown>;
  /** The next event while joined (native.ts); refused once the rider is no longer in a class. */
  receive(): Promise<unknown>;
  /** Leaves the class: native code closes the link and drops the token. */
  leave(): Promise<unknown>;
}

export interface InstructorModePlugin {
  /** Asks the native question "Switch to rider mode?". On a switch the page is replaced. */
  askRiderMode(): Promise<unknown>;
  /** The classes saved on this phone and the last sync's status: {classes, status} (issue #631). */
  listClasses(): Promise<unknown>;
  /** One saved class for the room screen: {document} or {error: "not_found"} (room/class-answer.ts reads it). */
  getClass(args: { id: string }): Promise<unknown>;
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
  // The music app's play, pause and next (issue #857), and no other command. Each is sent through
  // the music app's own media session, only while following: {state: "sent" | "notSent" |
  // "stopped" | "noAccess"}. None takes an argument. "send" because each only asks the music app:
  // nothing on the phone plays.
  sendPlay(): Promise<unknown>;
  sendPause(): Promise<unknown>;
  sendNext(): Promise<unknown>;
}

export const riderMode = (): RiderModePlugin => registerPlugin<RiderModePlugin>("RiderMode");

export const instructorMode = (): InstructorModePlugin => registerPlugin<InstructorModePlugin>("InstructorMode");

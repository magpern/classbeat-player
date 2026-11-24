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
  /** Unpairs this phone: native code revokes the token, deletes it and the saved classes, then leaves. */
  unpair(): Promise<unknown>;
  /** Opens the native pairing screen again once the pairing ran out. */
  pairAgain(): Promise<unknown>;
}

export const riderMode = (): RiderModePlugin => registerPlugin<RiderModePlugin>("RiderMode");

export const instructorMode = (): InstructorModePlugin => registerPlugin<InstructorModePlugin>("InstructorMode");

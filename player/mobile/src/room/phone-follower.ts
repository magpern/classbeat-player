// The room screen's follower on the phone (issue #872, app-follow.md): the phone's reader
// (follow/android-reader.ts) over the narrowed follow intents (follow-source.ts), and Follow's access
// ask (follow-ask.ts) with its sheet (follow-sheet.ts). Access is checked only when Follow is pressed;
// the app's return from Android's setting is the page becoming visible again.
import { createAndroidReader } from "../follow/android-reader.ts";
import type { RoomFollower } from "./clock-room.ts";
import { createFollowAsk } from "./follow-ask.ts";
import type { FollowAsk } from "./follow-ask.ts";
import type { RoomFollowSource } from "./follow-source.ts";
import { mountFollowSheet } from "./follow-sheet.ts";

export interface PhoneFollowerDeps {
  readonly now: () => number;
  readonly every: (fn: () => void, ms: number) => () => void;
}

export function phoneFollower(source: RoomFollowSource, win: Window, deps: PhoneFollowerDeps): RoomFollower {
  const reader = createAndroidReader(source, deps);
  // The sheet's keys call the ask, which is made after the sheet: a holder joins them.
  let ask: FollowAsk | null = null;
  const sheet = mountFollowSheet(win, { openSetting: () => ask?.openSetting(), notNow: () => ask?.notNow() });
  ask = createFollowAsk({
    access: () => source.followAccess(),
    openSetting: () => source.openFollowSetting(),
    sheet,
    onReturn: (fn) =>
      win.document.addEventListener("visibilitychange", () => {
        if (win.document.visibilityState === "visible") fn();
      }),
  });
  const asked = ask;
  return { reader, press: (turnOn, noReader) => asked.press(turnOn, noReader) };
}

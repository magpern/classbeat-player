// Asking for Notification access at the moment Follow is pressed, and only then (app-follow.md,
// "States"; ADR 0011 §6). With access, following goes on at once. Without it the follow sheet says
// why and what is read; "Open the setting" opens Android's list, and when the app comes back the
// access is checked again: given, the sheet closes by itself and following goes on; still off, the
// sheet says how to turn it on. "Not now" (or Back) closes the sheet and the clock stays manual.
// No DOM and no bridge here: the sheet, the access check and the app's return come in as deps.
import { parseAccess, parseAccessUnavailable } from "../follow/answers.ts";

export type SheetKind = "ask" | "still-off";

export interface SheetControl {
  show(kind: SheetKind): void;
  hide(): void;
  isOpen(): boolean;
}

export interface FollowAskDeps {
  /** followAccess: {granted} (follow/answers.ts). */
  access(): Promise<unknown>;
  /** openFollowSetting: Android's Notification access list for this app. */
  openSetting(): Promise<unknown>;
  readonly sheet: SheetControl;
  /** Calls [fn] each time the app comes back to the front. */
  onReturn(fn: () => void): void;
}

export interface FollowAsk {
  /** Follow pressed: following goes on through [turnOn] once access is there. */
  press(turnOn: () => void, noReader?: () => void): void;
  /** The sheet's "Open the setting". */
  openSetting(): void;
  /** The sheet's "Not now: manual clock", or Back. */
  notNow(): void;
}

export function createFollowAsk(deps: FollowAskDeps): FollowAsk {
  let turnOn: (() => void) | null = null;
  /** True from "Open the setting" until the app is back and access has been checked once. */
  let away = false;
  /** One access check at a time: a second press while one is out does nothing. */
  let checking = false;

  // A failed or garbled answer counts as no access: the sheet asks, nothing is turned on.
  // `none` runs instead of [then] when native code says there is no reader at all.
  const check = (then: (granted: boolean) => void, none?: () => void): void => {
    if (checking) return;
    checking = true;
    deps.access().then(
      (reply) => {
        checking = false;
        if (parseAccessUnavailable(reply) && none !== undefined) none();
        else then(parseAccess(reply));
      },
      () => {
        checking = false;
        then(false);
      },
    );
  };

  deps.onReturn(() => {
    if (!away || !deps.sheet.isOpen()) return;
    away = false;
    check((granted) => {
      if (!deps.sheet.isOpen() || turnOn === null) return;
      if (!granted) return deps.sheet.show("still-off");
      deps.sheet.hide();
      turnOn();
    });
  });

  return {
    press(on, noReader) {
      if (deps.sheet.isOpen()) return;
      turnOn = on;
      check(
        (granted) => {
          if (granted) on();
          else deps.sheet.show("ask");
        },
        noReader,
      );
    },
    openSetting() {
      if (!deps.sheet.isOpen()) return;
      away = true;
      deps.openSetting().catch(() => undefined);
    },
    notNow() {
      away = false;
      deps.sheet.hide();
    },
  };
}

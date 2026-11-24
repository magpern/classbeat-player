// "Remember on this phone" (docs/design/app-rider-join.md): the rider's FTP and maximum heart rate in
// the web view's localStorage, written only while the switch is on, under the rider page's key and
// format (web/src/rider/core/fields.ts). They never leave the phone, and the mode switch's storage
// drop deletes them (AndroidModeParts.kt). Nothing else is kept: never the nickname or the code, and
// the rider token never reaches this page at all.
import type { MyNumbers } from "../../../../web/src/rider/core/effort-calc.ts";
import { parseRemembered, rememberedText } from "../../../../web/src/rider/core/fields.ts";

export const NUMBERS_KEY = "classbeat.rider.numbers";

/** The page's storage, so tests can give a map. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class Numbers {
  private readonly store: () => Store;

  constructor(store: () => Store) {
    this.store = store;
  }

  /** Whether storage can be used here. It only reads: nothing is written to find out. */
  works(): boolean {
    try {
      this.store().getItem(NUMBERS_KEY);
      return true;
    } catch {
      return false;
    }
  }

  load(): MyNumbers | null {
    try {
      return parseRemembered(this.store().getItem(NUMBERS_KEY));
    } catch {
      return null;
    }
  }

  /** Writes the numbers; false when there is nothing to keep or storage refused. Only while Remember is on. */
  remember(n: MyNumbers): boolean {
    const text = rememberedText(n);
    if (text === null) {
      this.forget();
      return false;
    }
    try {
      this.store().setItem(NUMBERS_KEY, text);
      return true;
    } catch {
      return false;
    }
  }

  forget(): void {
    try {
      this.store().removeItem(NUMBERS_KEY);
    } catch {
      // Nothing stored.
    }
  }
}

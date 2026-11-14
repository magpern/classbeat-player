// What the rider page keeps on the phone (docs/design/rider.md, "What the page holds"):
// - the rider token, in `sessionStorage` only (never `localStorage`, a cookie, the address or a
//   log; gone when the tab closes); a browser that refuses storage keeps it in this tab's memory;
// - the rider's FTP and maximum heart rate, in `localStorage` only while "Remember on this phone"
//   is on, under one key. While it is off nothing is written there at all.
// Nothing here logs.
import type { MyNumbers } from "./core/effort-calc.ts";
import { parseRemembered, rememberedText } from "./core/fields.ts";
import { isRiderToken } from "./core/wire.ts";

const TOKEN_KEY = "classbeat.rider.token";
export const NUMBERS_KEY = "classbeat.rider.numbers";
let memory: string | null = null;

export function loadToken(): string | null {
  try {
    const v = sessionStorage.getItem(TOKEN_KEY);
    if (isRiderToken(v)) return v;
    if (v !== null) sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage refused: only what this tab holds in memory.
  }
  return memory;
}

export function saveToken(token: string): void {
  if (!isRiderToken(token)) return;
  memory = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Kept in memory only.
  }
}

export function forgetToken(): void {
  memory = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Whether `localStorage` can be used here. It only reads: nothing is written to find out. */
export function storageWorks(): boolean {
  try {
    localStorage.getItem(NUMBERS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadNumbers(): MyNumbers | null {
  try {
    return parseRemembered(localStorage.getItem(NUMBERS_KEY));
  } catch {
    return null;
  }
}

/** Writes the numbers; false when there is nothing to keep or storage refused. Called only while Remember is on. */
export function rememberNumbers(n: MyNumbers): boolean {
  const text = rememberedText(n);
  if (text === null) {
    forgetNumbers();
    return false;
  }
  try {
    localStorage.setItem(NUMBERS_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function forgetNumbers(): void {
  try {
    localStorage.removeItem(NUMBERS_KEY);
  } catch {
    // Nothing stored.
  }
}

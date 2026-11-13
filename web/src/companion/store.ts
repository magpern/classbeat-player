// The controller token's one home on the phone: `sessionStorage` of the site's origin (ADR 0005
// section 3). Never `localStorage`, a cookie, the address or a log; gone when the tab closes.
// A browser that refuses storage keeps the token in this tab's memory only.
import { isControllerToken } from "./core/wire.ts";

const KEY = "classbeat.companion.controller";
let memory: string | null = null;

export function loadToken(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (isControllerToken(v)) return v;
    if (v !== null) sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: only what this tab holds in memory.
  }
  return memory;
}

export function saveToken(token: string): void {
  if (!isControllerToken(token)) return;
  memory = token;
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Kept in memory only.
  }
}

export function forgetToken(): void {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

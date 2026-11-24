// What an ending does outside flow.ts (docs/design/app-rider-join.md, issue #633): when the class goes
// away for this page (left, removed, ended or lapsed), the remembered FTP and maximum heart rate are
// deleted from the phone, so the next rider on step 1 finds none. A lost link is not an ending.
import type { Flow } from "./flow.ts";

/** The one thing of the numbers' store an ending uses (numbers.ts). */
export interface Forgets {
  forget(): void;
}

/** Whether `was` to `next` ends the class; if so, the remembered numbers are deleted first. */
export function endIfOver(was: Flow, next: Flow, numbers: Forgets): boolean {
  if (!was.live || next.live) return false;
  numbers.forget();
  return true;
}

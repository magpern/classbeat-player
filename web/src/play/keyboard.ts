// The page's keyboard at the edge: key events in, the band's keys out (keys.ts decides). While the
// class screen is open the page cancels the browser's own action for every key the table names, so
// F5, Shift+F5, Space, Page Up and Page Down never reload or scroll the page and lose the class.
import type { Band } from "./band.ts";
import { keyAction } from "./keys.ts";

/** Starts listening; returns the function that stops. */
export function attachKeys(band: Pick<Band, "handleKey">): () => void {
  const down = (e: KeyboardEvent): void => {
    const a = keyAction({ key: e.key, shift: e.shiftKey, mod: e.ctrlKey || e.metaKey, alt: e.altKey, repeat: e.repeat });
    if (a !== null) e.preventDefault();
    band.handleKey(a);
  };
  // A space released over a focused button would press it: the key already acted on keydown.
  const up = (e: KeyboardEvent): void => {
    if (e.key === " ") e.preventDefault();
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  };
}

// The room window's keys (room-2d.md, "Keyboard"). Pure: a key press in, what it means out. None
// of them needs the band shown; only Tab, Shift+Tab and End show it.
//
// A presentation clicker's keys: Page Up and Page Down are Previous and Next. Its "start the show"
// key (F5, Shift+F5) is Start before the start and nothing after it, so a clicker button that
// sends F5 and Esc by turns never pauses a running class. Its "black screen" keys (B, ".") do
// nothing: the room screen never goes blank. None of these shows the band.

export interface KeyPress {
  readonly key: string;
  readonly shift: boolean;
  /** Ctrl, or Cmd on a Mac. */
  readonly mod: boolean;
  readonly alt: boolean;
  /** The key is held down and repeats. */
  readonly repeat: boolean;
}

export type KeyAction =
  | { readonly kind: "main" }
  | { readonly kind: "next" }
  | { readonly kind: "previous" }
  | { readonly kind: "jump"; readonly deltaMs: 5000 | -5000 }
  | { readonly kind: "undo" }
  | { readonly kind: "follow" }
  /** F5 and Shift+F5: Start, only before the start. */
  | { readonly kind: "start-only" }
  | { readonly kind: "end" }
  /** J: the join sheet (room-join.md, "Keyboard"). It does not show the band. */
  | { readonly kind: "join" }
  | { readonly kind: "escape" }
  | { readonly kind: "tab"; readonly back: boolean }
  /** Taken and dropped: the clicker's black-screen keys, and a held key's repeats. */
  | { readonly kind: "ignore" };

/** What a key does, or null for a key the page leaves alone (Enter on a focused button, and every other key). */
export function keyAction(k: KeyPress): KeyAction | null {
  if (k.key === "Tab" && !k.mod && !k.alt) return { kind: "tab", back: k.shift };
  if (k.key === "Escape") return { kind: "escape" };
  if (k.alt) return null;
  if (k.mod) return (k.key === "z" || k.key === "Z") && !k.shift ? (k.repeat ? { kind: "ignore" } : { kind: "undo" }) : null;
  const action = plain(k);
  if (action === null) return null;
  // Holding a key down never steps through the class: one press, one command.
  return k.repeat && action.kind !== "ignore" ? { kind: "ignore" } : action;
}

/**
 * Space, the arrows, the clicker's Page keys, F5 and J do nothing while the End question is open:
 * the question is answered first, with Enter, Esc or a press.
 */
export const waitsForQuestion = (a: KeyAction): boolean =>
  a.kind === "main" || a.kind === "next" || a.kind === "previous" || a.kind === "jump" || a.kind === "start-only" || a.kind === "join";

function plain(k: KeyPress): KeyAction | null {
  switch (k.key) {
    case " ":
      return { kind: "main" };
    case "ArrowRight":
      return k.shift ? { kind: "jump", deltaMs: 5000 } : { kind: "next" };
    case "ArrowLeft":
      return k.shift ? { kind: "jump", deltaMs: -5000 } : { kind: "previous" };
    case "PageDown":
      return { kind: "next" };
    case "PageUp":
      return { kind: "previous" };
    case "f":
    case "F":
      return { kind: "follow" };
    case "F5":
      return { kind: "start-only" };
    case "End":
      return { kind: "end" };
    case "j":
    case "J":
      return { kind: "join" };
    case "b":
    case "B":
    case ".":
      return { kind: "ignore" };
    default:
      return null;
  }
}

// The page's keys (docs/design/play.md, "Controls and keys"): the room screen's table minus the keys
// that have no meaning here (no Ctrl+Z, no F, no J). Pure: a key press in, what it means out.
//
// While the class screen is open the page cancels the browser's own action for F5, Shift+F5, Space,
// Page Up and Page Down, so a key never reloads the page and loses the class, or scrolls it; the
// reload shortcuts with Ctrl or Cmd are cancelled too (`cancelsBrowser`). A presentation clicker's
// "start the show" key (F5, Shift+F5) is Start before the start and nothing after it; its
// "black screen" keys (B, ".") do nothing: the screen never goes blank.

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
  | { readonly kind: "jump"; readonly delta: "forward" | "back" }
  /** F5 and Shift+F5: Start, only before the start. */
  | { readonly kind: "start-only" }
  | { readonly kind: "end" }
  | { readonly kind: "escape" }
  | { readonly kind: "tab"; readonly back: boolean }
  /** Taken and dropped: the clicker's black-screen keys, a held key's repeats and a reload with no command. */
  | { readonly kind: "ignore" };

/** What a key does, or null for a key the page leaves alone (Enter on a focused button, and every other key). */
export function keyAction(k: KeyPress): KeyAction | null {
  if (k.key === "Tab" && !k.mod && !k.alt) return { kind: "tab", back: k.shift };
  if (k.key === "Escape") return { kind: "escape" };
  // A reload with a modifier (Ctrl+F5, Ctrl+R, Cmd+R) is taken and dropped: the class is in memory only.
  if ((k.key === "F5" && (k.mod || k.alt)) || (k.mod && (k.key === "r" || k.key === "R"))) return { kind: "ignore" };
  if (k.alt || k.mod) return null;
  const action = plain(k);
  if (action === null) return null;
  // Holding a key down never steps through the class: one press, one command.
  return k.repeat && action.kind !== "ignore" ? { kind: "ignore" } : action;
}

/**
 * Space, the arrows, Page Up, Page Down, F5 and Shift+F5 do nothing while the End question is open:
 * the question is answered first, with Enter, Esc or a press. The browser's own action stays cancelled.
 */
export const waitsForQuestion = (a: KeyAction): boolean =>
  a.kind === "main" || a.kind === "next" || a.kind === "previous" || a.kind === "jump" || a.kind === "start-only";

/** Whether the page cancels what the browser would do with this key while the class screen is open. */
export const cancelsBrowser = (a: KeyAction | null): boolean => a !== null;

function plain(k: KeyPress): KeyAction | null {
  switch (k.key) {
    case " ":
      return { kind: "main" };
    case "ArrowRight":
      return k.shift ? { kind: "jump", delta: "forward" } : { kind: "next" };
    case "ArrowLeft":
      return k.shift ? { kind: "jump", delta: "back" } : { kind: "previous" };
    case "PageDown":
      return { kind: "next" };
    case "PageUp":
      return { kind: "previous" };
    case "F5":
      return { kind: "start-only" };
    case "End":
      return { kind: "end" };
    case "b":
    case "B":
    case ".":
      return { kind: "ignore" };
    default:
      return null;
  }
}

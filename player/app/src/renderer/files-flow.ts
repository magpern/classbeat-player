// The music files keys of the class list page (docs/design/music-files.md, "Keyboard"): "Find music
// files" asks the shell to open the folder window (it takes the class id and nothing else; the
// answer is read from the next list view, never from this call), "Show which files" and "Back" open
// and close the panel of the missing songs. After a search ends, the focus returns to the same key
// if it is still there, else to the list.
import type { Button } from "../core/list/states.ts";

export interface FilesFlowDeps {
  /** The selected class's id, or null. */
  readonly selectedId: () => string | null;
  /** Opens (an id) or closes (null) the panel of the missing songs. */
  readonly open: (id: string | null) => void;
  readonly find: (classId: string) => Promise<unknown>;
  readonly refresh: () => void;
}

export interface FilesFlow {
  /** True when the key was one of these. */
  act(id: Button["id"]): boolean;
  /** Called after every paint of the footer or the panel. */
  restoreFocus(root: HTMLElement, list: HTMLElement | null): void;
}

export function filesFlow(d: FilesFlowDeps): FilesFlow {
  let target: string | null = null;
  /** The key has been seen held, or the search has answered: the next paint may give the focus back. */
  let settled = false;
  return {
    act(id) {
      if (id === "files-show" || id === "files-back") {
        // Back returns the focus to the key that opened the panel.
        if (id === "files-back") {
          target = "files-show";
          settled = true;
        }
        d.open(id === "files-show" ? d.selectedId() : null);
        return true;
      }
      if (id !== "files-find") return false;
      const classId = d.selectedId();
      if (classId === null) return true;
      target = "files-find";
      settled = false;
      void d.find(classId).then(() => {
        settled = true;
        d.refresh();
      });
      // The shell sets the phase before it answers: the next view already says "Choose the folder".
      d.refresh();
      return true;
    },
    restoreFocus(root, list) {
      if (target === null) return;
      const el = root.querySelector<HTMLButtonElement>(`[data-action="${target}"]`);
      if (el !== null && el.disabled) {
        settled = true;
        return;
      }
      if (!settled) return;
      target = null;
      (el ?? list)?.focus();
    },
  };
}

// The presenter's music files lines (docs/design/music-files.md, "Presenter window, during a class"):
// "Manual clock, music stopped" and the song that failed, or "Manual clock" and how many files were
// missing when the class started, and, for a failure mid-class, a plate that appears in one frame,
// makes no sound, is closed with Close or Esc and does not come back for the class. The music line
// keeps the fact for the rest of the class. Text only through textContent; the words come from the
// shell (core/music-files/music-notice.ts) and name no path. The clock is not touched.
import type { Snapshot } from "../core/snapshot.ts";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

export function mountMusicNotice(): (s: Snapshot) => void {
  /** The class (load) whose plate was closed: it does not return for that class. */
  let closed = -1;
  let load = -1;
  let plateShown = false;
  const paint = (s: Snapshot): void => {
    const n = s.music ?? null;
    load = s.loadId;
    $("music").hidden = n === null;
    if (n === null) {
      plateShown = false;
      return;
    }
    $("music-line").textContent = n.line;
    $("music-detail").hidden = n.detail === null;
    $("music-detail").textContent = n.detail ?? "";
    plateShown = n.plate !== null && closed !== s.loadId;
    $("music-plate").hidden = !plateShown;
    $("music-plate-headline").textContent = n.plate?.headline ?? "";
    $("music-plate-body").textContent = n.plate?.body ?? "";
  };
  let last: Snapshot | null = null;
  const close = (): void => {
    if (!plateShown) return;
    closed = load;
    if (last !== null) paint(last);
  };
  $("music-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && plateShown) {
      e.preventDefault();
      close();
    }
  });
  return (s) => {
    last = s;
    paint(s);
  };
}

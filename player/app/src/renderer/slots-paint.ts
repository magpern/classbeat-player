// Paints the class list's four slots above the filter: the sync status or its plate, the Swedebeat
// line or its plate, the music files failure plate and the class file's error plate. Each slot is
// rebuilt only when what it shows changed, so a poll that finds nothing new touches nothing.
import type { Screen } from "../core/list/screen.ts";
import { plateEl, statusEl } from "./list-paint.ts";
import type { Act } from "./list-paint.ts";
import { mixLineEl, mixPlateEl } from "./mix-paint.ts";

export function slotsPainter(slot: (id: string) => HTMLElement, act: Act): (s: Screen) => void {
  const shown = { status: "", mix: "", files: "", file: "" };
  return (s) => {
    const status = JSON.stringify([s.status, s.plate]);
    if (status !== shown.status) {
      shown.status = status;
      slot("status-slot").replaceChildren(...(s.plate !== null ? [plateEl(s.plate, act, "status", false)] : s.status !== null ? [statusEl(s.status)] : []));
    }
    const mix = JSON.stringify([s.mixLine, s.mixPlate]);
    if (mix !== shown.mix) {
      shown.mix = mix;
      slot("mix-slot").replaceChildren(...(s.mixPlate !== null ? [mixPlateEl(s.mixPlate, act)] : s.mixLine !== null ? [mixLineEl(s.mixLine, act)] : []));
      // The sign-out question: "Keep connected" has the focus, so Enter or Esc keeps.
      if (s.mixPlate !== null) (slot("mix-slot").querySelector('[data-action="mix-keep"]') as HTMLElement | null)?.focus();
    }
    // A search of the music files that failed: a plate with "Try again" (docs/design/music-files.md).
    const failed = JSON.stringify(s.filesPlate);
    if (failed !== shown.files) {
      shown.files = failed;
      slot("files-slot").replaceChildren(...(s.filesPlate !== null ? [plateEl(s.filesPlate, act, "status", true)] : []));
    }
    const file = JSON.stringify(s.filePlate);
    if (file !== shown.file) {
      shown.file = file;
      slot("file-slot").replaceChildren(...(s.filePlate !== null ? [plateEl(s.filePlate, act, "alert", true)] : []));
    }
  };
}

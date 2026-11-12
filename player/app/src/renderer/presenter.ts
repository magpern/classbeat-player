// The minimal presenter: the class's intervals and the clock state, unstyled (the real screens
// wait for the design spec). Text only through textContent; nothing from a file becomes markup.
import { clockText, targetText, zoneText } from "../core/format.ts";
import type { Snapshot } from "../core/snapshot.ts";

interface PlayerApi {
  getState(): Promise<Snapshot | null>;
  command(cmd: unknown): Promise<Snapshot | null>;
  openDropped(name: string, text: string): Promise<Snapshot | null>;
  onUpdate(cb: (s: Snapshot) => void): void;
}

const api = (window as unknown as { player: PlayerApi }).player;
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
const setText = (id: string, text: string): void => {
  $(id).textContent = text;
};

let shownLoad = -1;

function renderIntervals(s: Snapshot): void {
  const body = $("intervals");
  if (s.loadId !== shownLoad) {
    shownLoad = s.loadId;
    body.replaceChildren();
    for (const [i, iv] of (s.doc?.intervals ?? []).entries()) {
      const row = document.createElement("tr");
      const cells = ["", String(i + 1), clockText(iv.start_ms), clockText(iv.length_ms), zoneText(iv.zone, s.doc?.zone_scale ?? []), targetText(iv), iv.cue];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        row.append(td);
      }
      body.append(row);
    }
  }
  const current = s.view?.intervalIndex ?? -1;
  [...body.children].forEach((row, i) => {
    const mark = i === current ? "now" : "";
    if (row.firstElementChild && row.firstElementChild.textContent !== mark) row.firstElementChild.textContent = mark;
    if (i === current) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  });
}

function render(s: Snapshot | null): void {
  if (!s) return;
  setText("title", s.doc ? s.doc.class.title : "No class open");
  const err = $("error");
  err.hidden = s.error === null;
  err.textContent = s.error?.message ?? "";
  const details = $("error-details");
  details.hidden = !s.error || s.error.details.length === 0;
  details.replaceChildren(
    ...(s.error?.details ?? []).map((d) => {
      const li = document.createElement("li");
      li.textContent = d;
      return li;
    }),
  );
  $("clock").hidden = s.view === null;
  if (s.view) {
    const v = s.view;
    setText("status", v.holding ? `${v.status} (holding at the end)` : v.status);
    setText("class-time", clockText(v.classMs));
    setText("class-length", clockText(v.lengthMs));
    setText("class-left", clockText(v.classRemainingMs));
    setText("interval-number", String(v.intervalIndex + 1));
    setText("interval-left", clockText(v.intervalRemainingMs));
    setText("crossfade", `${v.plannedCrossfadeMs / 1000} s`);
  }
  renderIntervals(s);
}

const buttons: Record<string, unknown> = {
  start: { type: "start" },
  pause: { type: "pause" },
  resume: { type: "resume" },
  previous: { type: "previous" },
  next: { type: "next" },
  back5: { type: "jump", deltaMs: -5000 },
  forward5: { type: "jump", deltaMs: 5000 },
};
for (const [id, cmd] of Object.entries(buttons)) {
  $(id).addEventListener("click", () => void api.command(cmd).then(render));
}

// Drag and drop: the dropped file's text goes to the shell, never its path. The page never
// navigates to a dropped file (the shell refuses navigation as well).
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  void file.text().then((text) => api.openDropped(file.name, text)).then(render);
});

api.onUpdate(render);
void api.getState().then(render);

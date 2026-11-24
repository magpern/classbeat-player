// The presenter's sensor panel (docs/design/sensors.md, part 2; ADR 0012 sections 3, 4 and 6). It
// reads a SensorSource and draws a SensorsView: a row, a drawer, the app's list of nearby devices.
// The renderer holds the readings in memory only: nothing is stored, sent, logged or passed to the
// clock, the timing, a target or the music link, and this file never calls the shell's bridge.
// The shipped source is the "unavailable" stand-in (WAITING FOR THE OWNER, section 6).
import { NO_NUMBERS, numbersFrom } from "../core/sensors/plan.ts";
import type { Numbers } from "../core/sensors/plan.ts";
import { NO_PLAN } from "../core/sensors/plan-input.ts";
import { NONE, step } from "../core/sensors/shown.ts";
import type { Shown } from "../core/sensors/shown.ts";
import { TEXT } from "../core/sensors/strings.ts";
import type { SensorSource } from "../core/sensors/types.ts";
import { buildView, freshValues } from "../core/sensors/view.ts";
import type { PlanInput } from "../core/sensors/view.ts";
import { deviceItem, liveText, measureItem, nearbyItem } from "./sensors-draw.ts";

/** How often the panel looks at the source; a shown number still steps at most once a second. */
export const CHECK_MS = 250;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};
const text = (el: HTMLElement, t: string): void => {
  if (el.textContent !== t) el.textContent = t;
};
const shown = (id: string, t: string | null): void => {
  const el = $(id);
  el.hidden = t === null;
  text(el, t ?? "");
};

export interface Sensors {
  /** The open class's current interval, for the plan each reading is set against. */
  setPlan(p: PlanInput): void;
}

export function mountSensors(source: SensorSource, now: () => number = () => performance.now()): Sensors {
  let open = false;
  let plan: PlanInput = NO_PLAN;
  let numbers: Numbers = NO_NUMBERS;
  let held: Shown = NONE;
  let lastKey = "";

  const render = (): void => {
    const snap = source.snapshot();
    const t = now();
    held = step(held, freshValues(snap, t), t);
    const v = buildView(snap, held.values, plan, numbers);
    $("sensors").dataset.state = snap.state;
    text($("sensors-state"), v.state);
    shown("sensors-line", v.line);
    $("sensors-connect").hidden = !v.canConnect;
    if (!v.canOpen && !v.choosing) open = false;
    const drawer = open || v.choosing;
    const toggle = $("sensors-toggle");
    toggle.hidden = !v.canOpen;
    text(toggle, drawer ? TEXT.hide : TEXT.show);
    toggle.setAttribute("aria-expanded", String(drawer));
    shown("sensors-live", !drawer && v.measures.length > 0 ? liveText(v) : null);
    $("sensors-drawer").hidden = !drawer;
    // The dynamic lists are rebuilt only when they change (a focused button keeps its focus).
    const key = JSON.stringify([v.measures, v.devices, v.nearby, v.choosing, v.failure, v.noNumbers, v.canOpen]);
    if (key === lastKey) return;
    lastKey = key;
    $("sensors-measures").replaceChildren(...v.measures.map(measureItem));
    shown("sensors-no-numbers", v.noNumbers);
    $("sensors-devices").replaceChildren(...v.devices.map((d) => deviceItem(d, (id, re) => (re ? source.reconnect(id) : source.disconnect(id)))));
    $("sensors-chooser").hidden = !v.choosing;
    $("sensors-nearby").replaceChildren(...v.nearby.map((d) => nearbyItem(d, (id) => source.choose(id))));
    shown("sensors-failed", v.failure);
    $("sensors-another").hidden = !(v.canOpen && !v.choosing);
  };

  text($("sensors-looking"), TEXT.looking);
  text($("sensors-note"), TEXT.note);
  text($("sensors-ftp-label"), TEXT.ftp);
  text($("sensors-hrmax-label"), TEXT.hrmax);
  text($("sensors-cancel"), TEXT.cancel);
  text($("sensors-connect"), TEXT.connect);
  text($("sensors-another"), TEXT.connectAnother);
  $("sensors-connect").addEventListener("click", () => source.connect());
  $("sensors-another").addEventListener("click", () => source.connect());
  $("sensors-cancel").addEventListener("click", () => source.cancel());
  $("sensors-toggle").addEventListener("click", () => {
    open = !open;
    render();
  });
  // The two numbers are the only inputs; they stay in this window's memory and clear with it.
  const read = (): void => {
    const n = (id: string): number | null => (($(id) as HTMLInputElement).value.trim() === "" ? null : Number(($(id) as HTMLInputElement).value));
    numbers = numbersFrom(n("sensors-ftp"), n("sensors-hrmax"));
    lastKey = "";
    render();
  };
  $("sensors-ftp").addEventListener("input", read);
  $("sensors-hrmax").addEventListener("input", read);
  source.subscribe(render);
  setInterval(render, CHECK_MS);
  render();
  return {
    setPlan(p) {
      if (p.interval === plan.interval && p.zone === plan.zone) return;
      plan = p;
      lastKey = "";
      render();
    },
  };
}

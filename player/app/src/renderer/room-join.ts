// The room screen's join sheet (room-join.md): the riders' QR code (`/j#<code>`), the instructor's
// (`/control#<code>`) and the join code as text. When it shows is core/room/join-sheet.ts's; this
// file owns the element and its one timer. It is drawn from the phone remote's slot only (the join
// code and the site): no rider, no count, no lock state and never a control code reach it. A new
// code redraws every code on the sheet in the same frame as the band's.
import { NO_SHEET, plateShown, sheetEscape, sheetFacts, sheetJoin, sheetTick, sheetWakeAt } from "../core/room/join-sheet.ts";
import type { JoinSheet } from "../core/room/join-sheet.ts";
import type { ClockStatus } from "../core/room/band-view.ts";
import { controlAddress, joinAddress, joinPageText } from "../core/room/remote.ts";
import type { RemoteView } from "../core/room/remote.ts";
import { sheetQrSvg } from "./room-qr.ts";

export interface Sheet {
  /** The clock's state and the slot as they are now. */
  facts(status: ClockStatus | null, slot: RemoteView): void;
  /** J; false when there is no code (the key does nothing). */
  join(): boolean;
  /** Esc; false when the sheet was not open (the band takes the key). */
  escape(): boolean;
  isOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, tier?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (tier) e.dataset.tier = tier;
  return e;
}

function qr(address: string, cls: string, alt: string): SVGSVGElement | null {
  const svg = sheetQrSvg(address);
  if (svg === null) return null;
  svg.setAttribute("class", cls);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", alt);
  return svg;
}

function cards(code: string, site: string | null, plate: boolean): HTMLElement[] {
  const riders = el("div", "card riders");
  const rq = site === null ? null : qr(joinAddress(site, code), "qr-riders", `QR code to join as a rider: ${joinAddress(site, code)}`);
  if (rq) riders.append(rq);
  const body = el("div", "body");
  // The heading and the plate share a box: side by side when the codes stack, so the plate costs no height.
  const head = el("div", "head");
  head.append(el("h1", "", "Join the class", "value"));
  if (plate) {
    const p = el("span", "plate-new", "New code", "label");
    p.setAttribute("role", "status");
    head.append(p);
  }
  body.append(head);
  body.append(el("p", "how", "Scan with your phone’s camera.", "minor"));
  const codeBox = el("div", "");
  codeBox.append(el("span", "lbl", "Class code", "label"), el("span", "code-big", code, "value"));
  body.append(codeBox);
  if (site !== null) {
    const open = el("div", "");
    open.append(el("span", "lbl", "Or open", "label"), el("span", "addr", joinPageText(site), "minor"));
    body.append(open);
  }
  riders.append(body);
  const out: HTMLElement[] = [riders];
  const iq = site === null ? null : qr(controlAddress(site, code), "qr-instr", `QR code for the instructor: ${controlAddress(site, code)}`);
  if (iq) {
    const instr = el("div", "card instr");
    const t = el("div", "itext");
    t.append(el("h2", "", "Instructor’s phone", "minor"), el("span", "lbl", "Scan, sign in and steer. It gives no control without your sign-in.", "label"));
    instr.append(iq, t);
    out.push(instr);
  }
  return out;
}

export function mountSheet(host: HTMLElement, changed: () => void): Sheet {
  const box = el("section", "join");
  box.setAttribute("aria-label", "Join codes");
  box.hidden = true;
  host.append(box);
  let s: JoinSheet = NO_SHEET;
  let site: string | null = null;
  let drawn = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const now = (): number => performance.now();

  function draw(): void {
    const plate = plateShown(s, now());
    const key = s.open && s.code !== null ? JSON.stringify([s.code, site, plate]) : "";
    if (key !== drawn) {
      if (key === "" || s.code === null) box.replaceChildren();
      else box.replaceChildren(...cards(s.code, site, plate));
      box.hidden = key === "";
      document.body.dataset.join = key === "" ? "closed" : "open";
      drawn = key;
    }
    clearTimeout(timer);
    const at = sheetWakeAt(s);
    if (at !== null) timer = setTimeout(() => set(sheetTick(s, now())), Math.max(0, at - now()));
  }

  function set(next: JoinSheet): void {
    const was = s.open;
    s = next;
    draw();
    if (was !== s.open) changed();
  }

  return {
    facts(status, slot) {
      site = slot.slot === "on" ? (slot.site ?? null) : null;
      set(sheetFacts(s, { status, code: slot.slot === "on" ? slot.joinCode : null }, now()));
    },
    join() {
      const r = sheetJoin(s, now());
      set(r.sheet);
      return r.taken;
    },
    escape() {
      const r = sheetEscape(s);
      set(r.sheet);
      return r.taken;
    },
    isOpen: () => s.open,
  };
}

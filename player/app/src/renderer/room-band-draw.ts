// Draws the control band's buttons and the End question from what core/room/band-view.ts says
// (room-2d.md, "Controls on the room screen"). No decision here: room-band.ts owns when it shows.
import type { BandView, ButtonView } from "../core/room/band-view.ts";
import { qrSvg } from "./room-qr.ts";

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, tier?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (tier) e.dataset.tier = tier;
  return e;
}

function buttonEl(b: ButtonView, cls: string): HTMLButtonElement {
  const e = make("button", `btn ${cls}`.trim());
  e.type = "button";
  e.dataset.id = b.id;
  e.disabled = b.disabled;
  e.append(make("span", "w", b.word, "control"));
  if (b.sub) e.append(make("span", "sub", b.sub, "label"));
  return e;
}

export function draw(band: HTMLElement, v: BandView): void {
  band.replaceChildren();
  if (v.mode === "finished") {
    const wrap = make("div", "finished");
    wrap.append(buttonEl(v.close, "quit"));
    band.append(wrap);
    return;
  }
  if (v.mode === "ask") {
    const ask = make("div", "ask");
    ask.append(make("span", "q", v.question, "text"), buttonEl(v.endClass, ""), make("span", "gap"), buttonEl(v.keepGoing, "quit"));
    band.append(ask);
    return;
  }
  if (v.follow) band.append(buttonEl(v.follow, "follow"));
  const transport = make("div", "transport");
  for (const b of v.transport) transport.append(buttonEl(b, b.id === "main" ? "main" : ""));
  band.append(transport);
  if (v.remote) band.append(buttonEl(v.remote, "phone"));
  if (v.code) {
    const code = make("div", "code");
    const qr = v.code.address ? qrSvg(v.code.address) : null;
    if (qr) code.append(qr);
    const t = make("div", "code-t");
    t.append(make("span", "lbl", "Class code", "label"), make("span", "v", v.code.code, "minor"), make("span", "dt", v.code.line, "label"));
    code.append(t);
    band.append(code);
  }
  band.append(buttonEl(v.end, "quit"));
}

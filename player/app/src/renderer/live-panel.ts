// The presenter's phone-remote panel (ADR 0005 sections 2, 3 and 5): start and end the phone
// remote, the class code, with a second display a control code and its QR code (live-qr.ts), the
// two phones' places with Drop, and the "Phone 1: pause" line. It only ever holds a LivePanelView
// (core/live/panel-view.ts): no host token. This panel is the presenter window's alone; the room
// window has no part of it. Text only through textContent.
import type { LivePanelView } from "../core/live/panel-view.ts";
import { renderQr } from "./live-qr.ts";

export interface LiveApi {
  liveView(): Promise<LivePanelView | null>;
  startLive(): Promise<LivePanelView | null>;
  endLive(): Promise<LivePanelView | null>;
  makeControlCode(): Promise<LivePanelView | null>;
  dropPhone(slot: 1 | 2): Promise<LivePanelView | null>;
}

const REFRESH_MS = 500;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

/** Shows the element with this text, or hides it when there is none. */
function line(id: string, text: string | null, textId = id): void {
  $(id).hidden = text === null;
  const el = $(textId);
  if (el.textContent !== (text ?? "")) el.textContent = text ?? "";
}

export function renderLive(v: LivePanelView | null): void {
  if (!v) return;
  $("live").hidden = !v.shown;
  $("live-status").textContent = v.status;
  line("live-detail", v.detail);
  line("live-page", v.controlPage, "live-page-url");
  line("live-class", v.classCode, "live-class-code");
  line("live-control", v.controlCode, "live-control-code");
  $("live-control-left").textContent = v.controlCodeLeft ?? "";
  renderQr($("live-qr"), $("live-qr-box"), v.controlLink);
  line("live-code-note", v.codeNote);
  $("live-slots").hidden = v.slots.length === 0;
  for (const slot of [1, 2] as const) {
    const s = v.slots.find((x) => x.slot === slot);
    $(`live-slot-${slot}-text`).textContent = s?.text ?? "";
    $(`live-drop-${slot}`).hidden = !(s?.canDrop ?? false);
  }
  line("live-line", v.line);
  $("live-start").hidden = !v.canStart;
  $("live-make-code").hidden = !v.canMakeCode;
  const end = $("live-end");
  end.hidden = !v.canEnd;
  if (end.textContent !== v.endText) end.textContent = v.endText;
}

export function mountLive(api: LiveApi): void {
  $("live-start").addEventListener("click", () => void api.startLive().then(renderLive));
  $("live-end").addEventListener("click", () => void api.endLive().then(renderLive));
  $("live-make-code").addEventListener("click", () => void api.makeControlCode().then(renderLive));
  $("live-drop-1").addEventListener("click", () => void api.dropPhone(1).then(renderLive));
  $("live-drop-2").addEventListener("click", () => void api.dropPhone(2).then(renderLive));
  const refresh = (): void => void api.liveView().then(renderLive);
  setInterval(refresh, REFRESH_MS);
  refresh();
}

// The pairing panel of the presenter: "Pair this computer", the code to type on the website, and
// Unpair. It only ever holds a PairingView (core/pairing/view.ts): no device code, no token. Text
// only through textContent.
import { clockText } from "../core/format.ts";
import type { PairingView } from "../core/pairing/view.ts";

interface PairingApi {
  startPairing(): Promise<PairingView | null>;
  pairingState(): Promise<PairingView | null>;
  unpair(): Promise<PairingView | null>;
}

const REFRESH_MS = 500;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

function statusOf(v: PairingView): string {
  switch (v.state) {
    case "unpaired":
      return "Not paired";
    case "starting":
      return "Asking the server for a code…";
    case "waiting":
      return "Waiting for the code to be confirmed on the website";
    case "paired":
      return v.pairAgain ? `The pairing with ${v.email} has run out: pair again` : `Paired with ${v.email}${v.deviceName === null ? "" : ` as “${v.deviceName}”`}`;
  }
}

function render(v: PairingView | null): void {
  if (!v) return;
  $("pairing-status").textContent = statusOf(v);
  $("pairing-wait").hidden = v.state !== "waiting";
  if (v.state === "waiting") {
    $("pairing-code").textContent = v.userCode;
    $("pairing-page").textContent = v.page;
    $("pairing-left").textContent = clockText(v.secondsLeft * 1000);
  }
  const message = v.state === "unpaired" ? v.message : null;
  $("pairing-message").hidden = message === null;
  $("pairing-message").textContent = message ?? "";
  $("pair").hidden = !(v.state === "unpaired" || (v.state === "paired" && v.pairAgain));
  $("pairing-cancel").hidden = v.state !== "starting" && v.state !== "waiting";
  $("unpair").hidden = v.state !== "paired";
}

export function mountPairing(api: PairingApi): void {
  $("pair").addEventListener("click", () => void api.startPairing().then(render));
  $("pairing-cancel").addEventListener("click", () => void api.unpair().then(render));
  $("unpair").addEventListener("click", () => void api.unpair().then(render));
  const refresh = (): void => void api.pairingState().then(render);
  setInterval(refresh, REFRESH_MS);
  refresh();
}

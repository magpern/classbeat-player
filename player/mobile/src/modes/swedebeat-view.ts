// The iOS app's dimmed Swedebeat states on the class list (issue #932; docs/design/swedebeat.md,
// "The iOS app"): the Swedebeat line and a class from Swedebeat. Built only while the build setting
// is off. Nothing here sends anything: pressing the key or the row does nothing and shows nothing.
// The key and the row stay in the tab order (aria-disabled, not disabled), as the update spec's dimmed key.
import { el } from "../../../../web/src/room/dom.ts";
import type { ClassRow } from "./classes.ts";
import { NOT_AVAILABLE, SWEDEBEAT_LINE, swedebeatFacts } from "../swedebeat-off.ts";

const DETAIL_ID = "swedebeat-detail";

/** A key that looks and reads as dimmed, describes itself by [detail] and does nothing when pressed. */
function dimmed(cls: string, action: string, children: readonly HTMLElement[], detail: string): HTMLButtonElement {
  const b = el("button", { class: `${cls} dim` }, children);
  b.type = "button";
  b.dataset.action = action;
  b.setAttribute("aria-disabled", "true");
  b.setAttribute("aria-describedby", detail);
  b.addEventListener("click", (e) => e.preventDefault());
  return b;
}

/** The Swedebeat line: hollow square, "Swedebeat", the message, and the dimmed key under them. Always shown. */
export function swedebeatLine(): HTMLElement {
  const state = el("span", { class: "sw-state", tier: "label", lines: 1, text: SWEDEBEAT_LINE.state });
  const detail = el("span", { class: "sw-detail", tier: "label", lines: 2, text: NOT_AVAILABLE });
  detail.id = DETAIL_ID;
  const k = dimmed("key full", "swedebeat_connect", [el("span", { class: "kl", tier: "minor", lines: 2, text: SWEDEBEAT_LINE.key })], DETAIL_ID);
  const box = el("div", { class: "swedebeat" }, [el("div", { class: "sw-words" }, [state, detail]), k]);
  box.setAttribute("role", "group");
  return box;
}

/** A class from Swedebeat: listed, never started. The message sits on its own line under the source and songs. */
export function swedebeatRow(c: ClassRow): HTMLButtonElement {
  const id = `swedebeat-row-${c.id}`;
  const message = el("span", { class: "kh sw-msg", tier: "label", lines: 2, text: NOT_AVAILABLE });
  message.id = id;
  return dimmed(
    "key row",
    "open_class",
    [
      el("span", { class: "kl", tier: "minor", lines: 2, text: c.title }),
      el("span", { class: "kh", tier: "label", lines: 1, text: swedebeatFacts(c.songs) }),
      message,
    ],
    id,
  );
}

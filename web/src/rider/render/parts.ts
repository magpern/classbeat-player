// Small pieces the rider's pages share, built as the companion's (docs/design/rider.md, "Wording").
// Every key is one of the page's own actions (check R5): none sends a command or touches equipment.
import { el } from "../../room/dom.ts";

export type PageAction = "join" | "forget" | "remember" | "my_numbers" | "done" | "retry";

export function pageKey(action: PageAction, label: string, o: { main?: boolean; dis?: boolean; full?: boolean } = {}, onPress?: () => void): HTMLButtonElement {
  const cls = ["key", o.full !== false && "full", o.main && "main", o.dis && "dis"].filter(Boolean).join(" ");
  const b = el("button", { class: cls }, [el("span", { class: "kl", tier: "minor", lines: 2, text: label })]);
  b.type = "button";
  b.dataset.action = action;
  if (o.dis) b.setAttribute("aria-disabled", "true");
  if (onPress) b.addEventListener("click", () => onPress());
  return b;
}

export const h1 = (text: string, lines = 2): HTMLElement => el("h1", {}, [el("span", { tier: "value", lines, text })]);

export const para = (text: string, small = false): HTMLElement => el("p", small ? { class: "small" } : {}, [el("span", { tier: small ? "label" : "minor", lines: 6, text })]);

export function plate(head: string, detail = ""): HTMLElement {
  const dt = detail ? [el("span", { class: "dt", tier: "label", lines: 4, text: detail })] : [];
  const p = el("div", { class: "plate" }, [el("span", { class: "h", tier: "minor", lines: 2, text: head }), ...dt]);
  p.setAttribute("role", "alert");
  return p;
}

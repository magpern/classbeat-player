// Rider mode's own pages (docs/design/app-rider-join.md): step 1 with the class code, step 2 as the
// rider page's join form with the mode tag and Back, and "Leave the class?". Text is only ever set
// with textContent: nothing the rider types becomes markup. The keys are the page's own actions;
// none sends a command or touches equipment.
import { shownWhileTyping } from "../../../../web/src/companion/core/codes.ts";
import type { Form } from "../../../../web/src/rider/core/join.ts";
import { joinPage } from "../../../../web/src/rider/render/form.ts";
import type { FormHandlers } from "../../../../web/src/rider/render/form.ts";
import { plate } from "../../../../web/src/rider/render/parts.ts";
import { el } from "../../../../web/src/room/dom.ts";
import { h1, key, modeTag, page, para } from "../modes/view.ts";
import { RIDER } from "../modes/words.ts";

export const LEAVE = {
  title: "Leave the class?",
  detail: "To join again, type the class code again.",
  leave: "Leave",
  keep: "Keep riding",
} as const;

export interface CodeHandlers {
  typed(text: string): void;
  continue(): void;
}

/** The class code field: capitals, the hyphen put in while typing, Enter as Continue. */
function codeField(f: Form, h: CodeHandlers): HTMLElement {
  const input = el("input", { class: "input", tier: "value" });
  input.id = "rider-code";
  input.type = "text";
  input.value = f.typed.code;
  input.placeholder = "XXXX-XXXX";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "go";
  input.maxLength = 12;
  input.setAttribute("autocapitalize", "characters");
  input.addEventListener("input", () => {
    const shown = shownWhileTyping(input.value);
    if (shown !== input.value) input.value = shown;
    h.typed(input.value);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      h.continue();
    }
  });
  const lab = el("label", { class: "lab", tier: "label", lines: 2, text: "Class code" });
  lab.htmlFor = input.id;
  const error = f.errors.code;
  const box = el("div", { class: `field${error ? " err" : ""}` }, [lab, input]);
  if (error) {
    const line = el("div", { class: "err-line" }, [el("span", { tier: "label", lines: 4, text: error })]);
    line.id = "rider-code-error";
    line.setAttribute("role", "alert");
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", line.id);
    box.append(line);
  }
  return box;
}

/** Step 1: the mode tag, the code, Continue and the mode strip; a plate after an ending or a refused switch. */
export function codePage(f: Form, h: CodeHandlers, plates: readonly HTMLElement[], stripNav: HTMLElement): HTMLElement {
  const lead = [modeTag(RIDER.tag), h1(RIDER.title), ...plates, para(RIDER.hint)];
  const go = key("key main", "continue", "Continue", () => h.continue());
  return page(lead, [codeField(f, h), el("div", { class: "duo solo" }, [go]), stripNav], "page form");
}

/** The plate step 1 shows: a head and, when there is one, a line under it. */
export const notice = (head: string, detail: string): HTMLElement => plate(head, detail);

/**
 * Step 2: the rider page's join form with the mode tag first and Back beside Join (not while
 * joining). Forget, while something is remembered, stays beside Join as on the web page.
 */
export function detailsPage(f: Form, h: FormHandlers, back: () => void): HTMLElement {
  const root = joinPage(f, h);
  root.querySelector(".lead")?.prepend(modeTag(RIDER.tag));
  const duo = root.querySelector(".duo");
  if (duo && !f.busy) {
    duo.prepend(key("key", "cancel", "Back", back));
    duo.classList.remove("solo");
  }
  return root;
}

/** "Leave the class?": Leave, and Keep riding as the main key with the focus. */
export function leavePage(leave: () => void, keep: () => void): HTMLElement {
  const duo = el("div", { class: "duo" }, [key("key", "leave", LEAVE.leave, leave), key("key main", "keep_riding", LEAVE.keep, keep)]);
  return page([h1(LEAVE.title), para(LEAVE.detail)], [duo]);
}

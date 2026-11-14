// The delete confirmation of the class details page (docs/design/site.md, "What every page
// has" and "Classes", Delete): a panel in the page, not a pop-up, in place of the actions row.
// "Keep the class" comes first and has the focus; Esc cancels; "Delete class" sends `DELETE
// classes/{id}`. A refusal or a failure is a plate inside the panel, and the page stays as it was.
import { deleteClass } from "../net/classes.ts";
import { el, t, uid } from "../ui/dom.ts";
import { button, buttons, p, working } from "../ui/kit.ts";
import { rememberDeleted } from "./deleted-note.ts";
import { offlinePlate, serverPlate, tooManyPlate } from "./errors.ts";
import type { SignedInEnv } from "./signed-in.ts";

export interface DeleteOptions {
  readonly id: string;
  /** The class's title for the note afterwards; null when the page never knew it. */
  readonly title: string | null;
  readonly env: SignedInEnv;
  /** The person kept the class: the actions row comes back and has the focus. */
  readonly keep: () => void;
  /** The route says the class is not there: the page shows its not-found state. */
  readonly gone: () => void;
}

/** The panel, with "Keep the class" focused once it is in the page (`focusKeep`). */
export function deletePanel(o: DeleteOptions): { readonly panel: HTMLElement; readonly focusKeep: () => void } {
  const headId = uid("delete-head");
  const head = el("h2", { id: headId }, [t("h2", "Delete this class?", 3)]);
  const keep = button("Keep the class", { primary: true, onPress: o.keep });
  const del = button("Delete class", { onPress: () => void run() });
  const panel = el("div", { class: "panel", role: "alertdialog", "aria-labelledby": headId }, [
    head,
    p("It is removed from your library at once, and from each of your devices when it next syncs. It cannot be undone here."),
    buttons(keep, del),
  ]);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !keep.disabled) {
      e.preventDefault();
      o.keep();
    }
  });
  let waitingOnline = false;

  const setBusy = (busy: boolean): void => {
    keep.disabled = busy;
    del.disabled = busy;
  };
  const showPlate = (plate: HTMLElement): void => {
    panel.querySelectorAll(".plate, .status").forEach((x) => x.remove());
    head.after(plate);
    plate.focus();
  };
  async function run(): Promise<void> {
    setBusy(true);
    panel.querySelectorAll(".plate, .status").forEach((x) => x.remove());
    const status = working("Deleting the class…");
    status.tabIndex = -1;
    head.after(status);
    status.focus();
    const answer = await deleteClass(o.id);
    if (!panel.isConnected || !o.env.current()) return;
    switch (answer.kind) {
      case "ok":
        rememberDeleted(o.title);
        return o.env.open("/classes");
      case "not_signed_in":
        return o.env.sessionEnded();
      case "refused":
        if (answer.status === 404) return o.gone();
        setBusy(false);
        return showPlate(serverPlate(() => void run()));
      case "too_many":
        setBusy(false);
        return showPlate(tooManyPlate(answer.retryAfter, () => void run()));
      case "offline":
        // The delete waits: it needs the server, so it stays off until the browser is back online.
        keep.disabled = false;
        showPlate(offlinePlate(() => void run()));
        if (!waitingOnline) {
          waitingOnline = true;
          window.addEventListener(
            "online",
            () => {
              waitingOnline = false;
              if (panel.isConnected && o.env.current() && del.disabled) void run();
            },
            { once: true },
          );
        }
        return;
      default:
        setBusy(false);
        return showPlate(serverPlate(() => void run()));
    }
  }
  return { panel, focusKeep: () => keep.focus() };
}

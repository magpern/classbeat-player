// Pair a device (docs/design/site.md, "Devices and pairing"; ADR 0002, section 6, step 3). The
// code is typed into the page: it is never read from the address, and it lives only in this
// closure and the field, sent in the body of `POST pairing/find` and `POST pairing/decide`.
// Nothing is written to storage, the address bar or a log. Nothing is approved without a press
// of "Pair this device": the page moves focus to its heading, never to that button.
import { afterDecide, afterFind, CODE_ERROR, continueWith, LIMIT_WORDS, NAME_ERROR, nameOf, pairPlateWords, showCode, START } from "../core/pairing-model.ts";
import type { PairNext, PairPlate, PairView } from "../core/pairing-model.ts";
import { call } from "../net/api.ts";
import { el, t } from "../ui/dom.ts";
import { button, buttons, field, h1, note, p, plate, working } from "../ui/kit.ts";
import { linkButton } from "./errors.ts";
import type { SignedInEnv } from "./signed-in.ts";
import "./devices.css";

type Found = Extract<PairView, { screen: "found" }>;

export function pairPage(main: HTMLElement, env: SignedInEnv, focusHeading: boolean): void {
  main.classList.add("narrow");
  let view: PairView = START;
  let busy = false;
  let again: (() => void) | null = null;

  const show = (next: PairNext): void => {
    busy = false;
    if (!env.current()) return;
    if (next.screen === "ended") return env.sessionEnded();
    view = next;
    draw(true);
  };

  const plateFor = (pl: PairPlate, retry: (() => void) | null): HTMLDivElement => {
    const w = pairPlateWords(pl);
    return plate(w.head, w.detail, pl.kind !== "not-found" && retry && button("Try again", { quiet: true, onPress: retry }));
  };

  async function find(typed: string): Promise<void> {
    if (busy) return;
    const next = continueWith(typed);
    if ("view" in next) return show(next.view);
    const { code } = next;
    busy = true;
    again = () => void find(typed);
    for (const b of main.querySelectorAll("button")) b.disabled = true;
    show(afterFind(typed, code, await call("POST", "pairing/find", { code })));
  }

  async function decide(found: Found, approve: boolean, typedName: string): Promise<void> {
    if (busy) return;
    const name = approve ? nameOf(typedName) : null;
    if (approve && name === null) {
      view = { ...found, name: typedName, nameError: true, plate: undefined };
      return draw(true);
    }
    busy = true;
    view = { ...found, name: typedName, nameError: false, plate: undefined };
    draw(false, approve ? "Pairing this device…" : "Refusing the pairing…");
    const body = approve ? { code: found.code, approve: true, name } : { code: found.code, approve: false };
    show(afterDecide(found, approve, name ?? typedName, await call("POST", "pairing/decide", body)));
  }

  function enter(v: Extract<PairView, { screen: "enter" }>): Node[] {
    const f = field("Code", {
      type: "text",
      name: "code",
      value: v.typed,
      hint: v.codeError ? undefined : "Eight letters, for example BCDF-GHJK. Type only a code you can see on your own screen right now.",
      error: v.codeError ? CODE_ERROR : undefined,
    });
    f.input.classList.add("code");
    // Kept out of the browser's form history: a code is used once.
    f.input.autocomplete = "off";
    f.input.autocapitalize = "characters";
    const submit = button("Continue", { primary: true, full: true, submit: true });
    const form = el("form", { class: "pair" }, [f.root, buttons(submit)]);
    form.noValidate = true;
    // Never a native submission: it would put the code in an address.
    form.method = "post";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void find(f.input.value);
    });
    return [h1("Pair a device"), v.plate ? plateFor(v.plate, again) : p("Type the code shown in the player on your computer."), form];
  }

  function found(v: Found, waitingWords?: string): Node[] {
    const f = field("Name this device", { type: "text", name: "name", value: v.name, hint: v.nameError ? undefined : "One to 40 characters, so you can tell your devices apart.", error: v.nameError ? NAME_ERROR : undefined });
    f.input.autocomplete = "off";
    // Enter in the name field approves nothing: only a press of the button does.
    f.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    const off = waitingWords !== undefined;
    const pair = button("Pair this device", { primary: true, full: true, disabled: off, onPress: () => void decide(v, true, f.input.value) });
    const deny = button("Not this one", { full: true, disabled: off, onPress: () => void decide(v, false, f.input.value) });
    const asks = el("div", { class: "dev-facts" }, [el("div", {}, [t("small", "A player is asking to be paired", 2)]), el("div", { class: "dev-who" }, [t("title", `${v.platform}, version ${v.version}`, 3)])]);
    return [
      h1("Pair this device?"),
      v.plate ? plateFor(v.plate, null) : null,
      asks,
      p("Confirm only if this code is on your own screen right now."),
      el("div", { class: "dev-codebox" }, [t("code", showCode(v.code), 1)]),
      f.root,
      off ? working(waitingWords) : null,
      buttons(pair, deny),
    ].filter((n) => n !== null);
  }

  const toDevices = (): HTMLAnchorElement => linkButton("See your devices", "/devices", true);

  function screen(waitingWords?: string): Node[] {
    switch (view.screen) {
      case "enter":
        return enter(view);
      case "found":
        return found(view, waitingWords);
      case "approved":
        return [h1("Paired"), note(`“${view.name}” is paired`, "The player picks it up within a few seconds. You can close this page."), buttons(toDevices())];
      case "denied":
        return [h1("Pairing refused"), note("Nothing was paired", "The player says the pairing was refused."), buttons(toDevices())];
      case "limit": {
        const go = linkButton("Go to devices", "/devices");
        go.classList.add("q");
        return [h1("Pair this device?"), plate(LIMIT_WORDS.head, LIMIT_WORDS.detail, go)];
      }
    }
  }

  function draw(moveFocus: boolean, waitingWords?: string): void {
    main.replaceChildren(...screen(waitingWords));
    if (!moveFocus) return;
    // Focus goes where the change is: a plate, a field in error, a note; the found view's heading.
    const target = main.querySelector<HTMLElement>(".plate") ?? main.querySelector<HTMLElement>(".field.err input") ?? main.querySelector<HTMLElement>(".note") ?? (view.screen === "enter" ? main.querySelector<HTMLElement>("input[name=code]") : main.querySelector<HTMLElement>("h1"));
    target?.focus();
  }

  main.replaceChildren(...screen());
  if (focusHeading) main.querySelector<HTMLElement>("h1")?.focus();
}

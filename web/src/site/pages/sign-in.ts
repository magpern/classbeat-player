// The sign-in page (docs/design/site.md, "Sign in"): the email link, a passkey, and the pages
// around them. The link token lives only in this closure: it is sent in the body of one POST
// and dropped once used. Nothing is written to storage and nothing is logged.
import { afterLinkAsked, afterLinkUsed, afterPasskey, NOTICE_WORDS, plateWords } from "../core/sign-in-model.ts";
import type { Next, PasskeyOutcome, Plate, SignInView } from "../core/sign-in-model.ts";
import { call } from "../net/api.ts";
import { passkeySignIn } from "../net/passkey.ts";
import { el } from "../ui/dom.ts";
import { button, buttons, field, h1, h2, note, or, p, plate, small, working } from "../ui/kit.ts";

export interface SignInEnv {
  readonly passkey: boolean;
  readonly signedIn: () => void;
}

type Form = Extract<SignInView, { screen: "form" }>;
type Focus = "heading" | "auto" | "none";

const INVALID_EMAIL = "That does not look like an email address. Check it and try again.";

export function signInPage(main: HTMLElement, start: SignInView, env: SignInEnv, linkToken: string | null, firstFocus: Focus): void {
  let token = linkToken;
  let view: SignInView = start;
  let again: (() => void) | null = null;

  const show = (next: Next, focus: Focus = "auto"): void => {
    if (next.screen === "signed-in") {
      token = null;
      env.signedIn();
      return;
    }
    view = next;
    draw(focus);
  };

  function plateFor(pl: Plate): HTMLDivElement {
    const w = plateWords(pl);
    const retry = pl.kind === "passkey-failed" ? usePasskey : pl.kind === "offline" || pl.kind === "server" || pl.kind === "too-many" ? again : null;
    return plate(w.head, w.detail, retry && button("Try again", { quiet: true, onPress: retry }));
  }

  async function askLink(raw: string): Promise<void> {
    const email = raw.trim();
    again = () => void askLink(email);
    if (email === "") return show({ screen: "form", email: raw, emailError: true });
    // Working: every button waits for the answer (the page does not redraw, so nothing moves).
    for (const b of main.querySelectorAll("button")) b.disabled = true;
    const answer = await call("POST", "sign-in/link", { email });
    show(afterLinkAsked(email, answer));
  }

  async function useLink(): Promise<void> {
    if (token === null) return;
    const sent = token;
    again = () => void useLink();
    show({ screen: "link", busy: true });
    const answer = await call("POST", "sign-in/complete", { token: sent });
    const next = afterLinkUsed(answer);
    // A refused link cannot be used again: it is dropped.
    if (next.screen === "form") token = null;
    show(next);
  }

  async function usePasskey(): Promise<void> {
    const email = currentEmail();
    again = () => void usePasskey();
    show({ screen: "form", email, busy: "passkey" });
    const outcome: PasskeyOutcome = await passkeySignIn();
    show(afterPasskey(email, outcome));
  }

  function currentEmail(): string {
    const input = main.querySelector<HTMLInputElement>("input[name=email]");
    return input ? input.value : view.screen === "link" ? "" : view.email;
  }

  function form(v: Form): Node[] {
    const out: Node[] = [h1("Sign in")];
    if (v.plate) out.push(plateFor(v.plate));
    else if (v.notice) out.push(note(NOTICE_WORDS[v.notice].head, NOTICE_WORDS[v.notice].detail));
    if (v.plate?.kind === "link-refused") out.push(h2("Get a new link"), p("Ask for it in the browser you want to sign in with."));
    if (v.busy === "passkey") out.push(working("Waiting for your passkey. Follow the prompt from your browser or device."));
    const plain = !v.plate && !v.notice && !v.emailError;
    const f = field("Email address", {
      type: "email",
      name: "email",
      value: v.email,
      autocomplete: "email",
      placeholder: "you@example.com",
      hint: plain ? "We send you a link. There is no password." : undefined,
      error: v.emailError ? INVALID_EMAIL : undefined,
    });
    const submit = button("Email me a sign-in link", { primary: true, full: true, submit: true, disabled: !!v.busy });
    const formEl = el("form", { class: "signin" }, [f.root, buttons(submit)]);
    formEl.noValidate = true;
    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      void askLink(f.input.value);
    });
    out.push(formEl);
    if (env.passkey) {
      const waiting = v.busy === "passkey";
      out.push(or(), button(waiting ? "Waiting for your passkey…" : "Sign in with a passkey", { full: true, disabled: !!v.busy, onPress: () => void usePasskey() }), small("A passkey uses this device's fingerprint, face or screen lock."));
    }
    return out;
  }

  function sent(v: Extract<SignInView, { screen: "sent" }>): Node[] {
    return [
      h1("Check your mail"),
      note(`A link is on its way if ${v.email} can sign in`),
      p("The link works once, for 15 minutes, and only in this browser. Open it here."),
      small("Nothing arrived in a few minutes? Check the spam folder and the spelling of the address. Only addresses that have been let in can sign in."),
      buttons(
        button("Send the link again", { onPress: () => void askLink(v.email) }),
        button("Use a different address", { onPress: () => show({ screen: "form", email: "" }) }),
      ),
    ];
  }

  function link(v: Extract<SignInView, { screen: "link" }>): Node[] {
    return [
      h1("Finish signing in"),
      v.plate ? plateFor(v.plate) : null,
      v.busy ? working("Signing you in…") : p("Press the button to sign in. This works only in the browser where you asked for the link."),
      buttons(button("Sign in", { primary: true, full: true, disabled: v.busy, onPress: () => void useLink() })),
      v.busy ? null : small("Did not ask for this? Close the page. Nothing happens until you press the button."),
    ].filter((n) => n !== null);
  }

  function draw(focus: Focus): void {
    main.replaceChildren(...(view.screen === "form" ? form(view) : view.screen === "sent" ? sent(view) : link(view)));
    if (focus === "none") return;
    if (focus === "heading") return main.querySelector<HTMLElement>("h1")?.focus();
    // Focus goes where the change is: a plate, a field in error, a note, the working line, or
    // the one button of the link page.
    const own = view.screen === "form" ? "input[name=email]" : view.screen === "sent" ? ".note" : ".btn.primary";
    const target = main.querySelector<HTMLElement>(".plate") ?? main.querySelector<HTMLElement>(".field.err input") ?? main.querySelector<HTMLElement>(".status") ?? main.querySelector<HTMLElement>(own);
    if (target?.classList.contains("status")) target.tabIndex = -1;
    target?.focus();
  }

  draw(firstFocus);
}

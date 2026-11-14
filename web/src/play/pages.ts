// The states around the picker (docs/design/play.md, "The picker and the states around it"): pages
// of the website, built from its own blocks. Text is only ever set with textContent: nothing an
// answer holds becomes markup. Each function replaces the content of `main`.
import { linkButton } from "../site/pages/errors.ts";
import { button, buttons, h1, h2, note, p, plate, working } from "../site/ui/kit.ts";

export const HEADING = "Play a class";

export const loading = (main: HTMLElement): void => main.replaceChildren(h1(HEADING), working("Loading your classes…"));

/** `/play#<class id>`: the class and every asset it needs are on their way. */
export const opening = (main: HTMLElement): void => main.replaceChildren(h1(HEADING), working("Getting the class ready…"));

export const empty = (main: HTMLElement): void =>
  main.replaceChildren(h1(HEADING), h2("No classes yet"), p("Classes you send from classbeat appear here, and on this page."), buttons(linkButton("Classes", "/classes", true)));

/** Signed out, or (`ended`) a session that ended: Sign in goes to `signInAddress`, which comes back here. */
export function signedOut(main: HTMLElement, ended: boolean, signInAddress: string): void {
  main.replaceChildren(
    h1(HEADING),
    ended ? note("Your session ended", "Sign in again to carry on where you were.") : p("Sign in to see your classes and run one here."),
    buttons(linkButton("Sign in", signInAddress, true)),
  );
  main.querySelector<HTMLElement>(".note")?.focus();
}

/** No answer: nothing is stored, so there is nothing to show from before. */
export function offline(main: HTMLElement, retry: () => void): void {
  main.replaceChildren(
    h1(HEADING),
    plate("You are offline", "Check your connection. Your classes cannot be fetched now. Once a class is open, it runs without the internet.", button("Try again", { quiet: true, onPress: retry })),
  );
  main.querySelector<HTMLElement>(".plate")?.focus();
}

/** 404: a deleted class, an unknown id and another account's id all give this. */
export function notFound(main: HTMLElement, toPicker: () => void): void {
  main.replaceChildren(h1("That class is not here"), p("It may have been deleted, or the link is not one of your classes."), buttons(button("Your classes", { primary: true, onPress: toPicker })));
  main.querySelector<HTMLElement>("h1")?.focus();
}

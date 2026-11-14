// The /play page (ADR 0008): which of its states shows, and how they follow one another. The address
// is `/play` (the picker) or `/play#<class id>` (that class on the room screen). The class stays in
// memory only: nothing is written to the browser, so a reload starts the class again from its start.
// From Start to the end of the class the page sends no request of any kind (player.ts).
import { offlinePlate, serverFault, serverPlate, tooMany, tooManyPlate } from "../site/pages/errors.ts";
import { call } from "../site/net/api.ts";
import { frame, PRODUCT } from "../site/ui/shell.ts";
import { loadAssets } from "./assets.ts";
import { loadClass, loadClasses } from "./library.ts";
import type { Failure } from "./library.ts";
import { setMode } from "./page-mode.ts";
import { empty, HEADING, loading, notFound, offline, opening, signedOut } from "./pages.ts";
import { classList } from "./picker.ts";
import { openPlayer } from "./player.ts";
import type { Player } from "./player.ts";
import { classIdOf, PICKER_ADDRESS, SIGN_IN_ADDRESS, signInBackAddress } from "./route.ts";

let shown = 0;
let player: Player | null = null;
/** Whether any answer so far said there was a session: a 401 after that is "Your session ended". */
let hadSession = false;
/** Only the page's first class counts as "reloaded": a class opened from the picker is not. */
let firstOpen = true;

const navigationType = (): string => {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? "navigate";
};

/** Signs out through the site's route, then goes to the site's sign-in page (a full page load). */
async function signOut(main: HTMLElement): Promise<void> {
  const answer = await call("POST", "sign-out");
  if (answer.kind === "ok") return location.assign(SIGN_IN_ADDRESS);
  main.querySelector(".plate")?.remove();
  const retry = (): void => void signOut(main);
  const p = answer.kind === "offline" ? offlinePlate(retry) : answer.kind === "too_many" ? tooManyPlate(answer.retryAfter, retry) : serverPlate(retry);
  const head = main.querySelector("h1");
  if (head) head.after(p);
  else main.prepend(p);
  p.focus();
}

/** The page frame (header and main) with the current section none; signed out has no navigation. */
function page(signedIn: boolean): HTMLElement {
  document.title = `${HEADING} · ${PRODUCT}`;
  const main: HTMLElement = signedIn ? frame({ nav: null, onSignOut: () => void signOut(main) }) : frame({});
  return main;
}

function toPicker(): void {
  history.replaceState(null, "", PICKER_ADDRESS);
  route();
}

/** At most one wait for the connection: "Try again" while offline adds no other, and leaving the page ends it. */
let onlineWait: (() => void) | null = null;
function stopOnlineWait(): void {
  if (onlineWait) window.removeEventListener("online", onlineWait);
  onlineWait = null;
}

/** What a failed answer shows; `retry` is what "Try again" does, and what the page does by itself when the browser is back online. */
function failure(main: HTMLElement, why: Failure, retryNow: () => void): void {
  const retry = (): void => {
    stopOnlineWait();
    retryNow();
  };
  switch (why.kind) {
    case "not_signed_in":
      return signedOutPage(hadSession);
    case "gone":
    case "refused":
      return notFound(main, toPicker);
    case "too_many":
      return tooMany(main, why.retryAfter, retry);
    case "offline":
      offline(main, retry);
      onlineWait = retry;
      window.addEventListener("online", retry, { once: true });
      return;
    default:
      return serverFault(main, retry);
  }
}

function signedOutPage(ended: boolean): void {
  signedOut(page(false), ended, signInBackAddress(location.hash));
}

async function showPicker(ticket: number): Promise<void> {
  const main = page(true);
  loading(main);
  const loaded = await loadClasses(() => (hadSession = true));
  if (ticket !== shown) return;
  if (loaded.kind === "failed") return failure(main, loaded.why, () => ticket === shown && void showPicker(ticket));
  hadSession = true;
  if (loaded.value.length === 0) empty(main);
  else classList(main, loaded.value, new Date());
}

async function showClass(id: string, ticket: number, reloaded: boolean): Promise<void> {
  const main = page(true);
  opening(main);
  const loaded = await loadClass(id);
  if (ticket !== shown) return;
  if (loaded.kind === "failed") return failure(main, loaded.why, () => ticket === shown && void showClass(id, ticket, reloaded));
  hadSession = true;
  // Everything the class needs is in before Start is offered; from Start the page asks for nothing.
  await loadAssets();
  if (ticket !== shown) return;
  document.title = `${loaded.value.class.title} · ${PRODUCT}`;
  document.body.replaceChildren();
  setMode("room");
  player = openPlayer(loaded.value, { reloaded, onEnd: toPicker });
}

/** Shows the state the address names; the page that was there goes first. */
export function route(): void {
  const ticket = (shown += 1);
  player?.destroy();
  player = null;
  stopOnlineWait();
  setMode("page");
  const id = classIdOf(location.hash);
  // A fragment that is no class id is ignored: the picker shows (ADR 0008, section 2).
  if (location.hash !== "" && id === null) history.replaceState(null, "", PICKER_ADDRESS);
  const reloaded = firstOpen && id !== null && navigationType() === "reload";
  firstOpen = false;
  void (id === null ? showPicker(ticket) : showClass(id, ticket, reloaded));
}

export function start(): void {
  window.addEventListener("hashchange", route);
  route();
}

// The handlebar companion page (docs/design/companion.md): the edge that joins the pure core to the
// browser. It reads the fragment boot.ts took, asks the site for a controller token, holds it in
// sessionStorage only (store.ts), opens the live WebSocket, and draws what the core says. A tick
// four times a second runs the countdown between state messages. Nothing here logs.
import { outcomeOf } from "./core/answer.ts";
import { answered, initialEntry, submit, typed } from "./core/entry.ts";
import type { Entry, Field, Way } from "./core/entry.ts";
import { NOT_LIVE_FOR_MS, press, startLive, step } from "./core/session.ts";
import type { Delta, Event, Live } from "./core/session.ts";
import type { Action } from "./core/state-check.ts";
import { liveView } from "./core/view.ts";
import { idFromBytes } from "./core/wire.ts";
import type { Fragment } from "./core/codes.ts";
import { post, signedIn } from "./net.ts";
import { connectingPage, droppedPage, endedPage, entryPage, lostPage } from "./render/pages.ts";
import { RunScreen } from "./render/run.ts";
import { LiveSocket } from "./socket.ts";
import { forgetToken, loadToken, saveToken } from "./store.ts";
import { ScreenWake } from "./wake.ts";

const TICK_MS = 250;
/** The site's sign-in page (the website, issue #144). */
export const SIGN_IN_PATH = "/sign-in";

const now = (): number => performance.now();
const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class CompanionApp {
  private entry: Entry;
  private live: Live | null = null;
  private socket: LiveSocket | null = null;
  private run: RunScreen | null = null;
  private lastHeard = 0;
  /** What is on screen, so a page is built again only when it changes. */
  private shown = "";
  private readonly host: HTMLElement;
  private readonly wake: ScreenWake;

  constructor(host: HTMLElement, fragment: Fragment) {
    this.host = host;
    this.wake = new ScreenWake(() => this.draw(true));
    this.entry = initialEntry(fragment.join);
    setInterval(() => this.tick(), TICK_MS);
    addEventListener("resize", () => this.run?.fit());
    const token = loadToken();
    if (fragment.join && fragment.control) {
      // The presenter window's QR code: class code and control code, sent at once.
      this.entry = { ...this.entry, controlCode: fragment.control };
      void this.send("code");
    } else if (token && !fragment.join) this.connect(token);
    this.draw();
    if (!this.live) void this.probe();
  }

  /** Asks the site whether this browser is signed in; the answer picks the entry page's form. */
  private async probe(): Promise<void> {
    const yes = await signedIn();
    this.entry = { ...this.entry, signedIn: yes };
    this.draw();
  }

  private async send(way: Way): Promise<void> {
    const r = submit(this.entry, way);
    this.entry = r.entry;
    if ("signIn" in r) {
      location.assign(SIGN_IN_PATH);
      return;
    }
    this.draw();
    if (!("send" in r)) return;
    const outcome = outcomeOf(await post(r.send));
    const a = answered(this.entry, way, outcome);
    this.entry = a.entry;
    if (a.token) {
      saveToken(a.token);
      this.entry = { ...this.entry, controlCode: "" };
      this.connect(a.token);
    }
    this.draw();
  }

  private connect(token: string): void {
    this.socket?.stop();
    this.live = startLive();
    this.lastHeard = now();
    const socket = new LiveSocket(token, (e) => this.onEvent(socket, e), now);
    this.socket = socket;
    socket.start();
    this.wake.want(true);
  }

  private onEvent(socket: LiveSocket, e: Event): void {
    if (socket !== this.socket || !this.live) return;
    if (e.type === "message" || e.type === "opened") this.lastHeard = e.at;
    this.live = step(this.live, e);
    if (this.live.gone) this.leave(false);
    this.draw();
  }

  /** The socket is done with: closed by the page, or the session dropped or ended this phone. */
  private leave(clear: boolean): void {
    this.socket?.stop();
    this.socket = null;
    forgetToken();
    this.wake.want(false);
    if (clear) this.live = null;
  }

  private tick(): void {
    if (!this.live || this.live.gone) return;
    const at = now();
    this.live = step(this.live, { type: "tick", at });
    // Connected, the computer in, and nothing heard for 10 s: the connection has gone quiet.
    if (this.live.conn === "open" && this.live.hostIn && at - this.lastHeard > NOT_LIVE_FOR_MS) {
      this.lastHeard = at;
      this.socket?.restart();
    }
    this.draw();
  }

  private onPress(action: Action, deltaMs?: Delta): void {
    if (!this.live || !this.socket) return;
    const id = idFromBytes(crypto.getRandomValues(new Uint8Array(16)));
    const r = press(this.live, action, id, now(), deltaMs);
    if (!r || !this.socket.send(r.command)) return;
    this.live = r.live;
    this.draw();
  }

  /** "Cancel" and "Get control again": back to the entry page with the class code kept. */
  private backToEntry(): void {
    this.leave(true);
    this.entry = { ...initialEntry(this.entry.classCode || null), signedIn: this.entry.signedIn };
    this.draw();
    void this.probe();
  }

  private onTyped(field: Field, text: string): void {
    const before = this.entry.error;
    this.entry = typed(this.entry, field, text);
    if (before !== this.entry.error) this.draw();
  }

  private mount(key: string, build: () => HTMLElement, force: boolean): void {
    if (!force && key === this.shown) return;
    const focused = document.activeElement instanceof HTMLInputElement ? document.activeElement.id : "";
    this.shown = key;
    this.run = null;
    this.host.replaceChildren(build());
    const again = focused ? document.getElementById(focused) : null;
    if (again instanceof HTMLInputElement) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  }

  private draw(force = false): void {
    const live = this.live;
    if (!live) {
      const e = this.entry;
      const key = JSON.stringify(["entry", e.signedIn, e.busy, e.error, e.full, this.wake.works]);
      this.mount(key, () => entryPage(e, this.wake.works, { typed: (f, t) => this.onTyped(f, t), submit: (w) => void this.send(w) }), force);
      return;
    }
    const v = liveView(live, now());
    switch (v.kind) {
      case "connecting":
        return this.mount("connecting", () => connectingPage(() => this.backToEntry()), force);
      case "dropped":
        return this.mount("dropped", () => droppedPage(() => this.backToEntry()), force);
      case "ended":
        return this.mount("ended", () => endedPage(() => this.backToEntry()), force);
      case "lost":
        return this.mount(JSON.stringify(v), () => lostPage(v, () => this.socket?.retryNow()), force);
      case "run":
        if (!this.run || this.shown !== "run") {
          const screen = new RunScreen({ press: (a, d) => this.onPress(a, d), now, reducedMotion });
          this.mount("run", () => screen.root, true);
          this.run = screen;
        }
        this.run.update(v);
    }
  }
}

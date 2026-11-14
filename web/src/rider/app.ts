// The rider page (docs/design/rider.md): the edge that joins the pure core to the browser. It reads
// the class code from the fragment (and keeps it there), sends the join request, holds the rider
// token in sessionStorage only (store.ts), opens the live WebSocket and draws what the core says.
// The rider's FTP and maximum heart rate stay in this tab's memory, and in localStorage only while
// "Remember on this phone" is on; they are never sent. A tick four times a second runs the
// countdown between state messages. Nothing here logs.
import { ScreenWake } from "../companion/wake.ts";
import { riderAddress } from "./core/address.ts";
import { NO_NUMBERS } from "./core/effort-calc.ts";
import type { MyNumbers } from "./core/effort-calc.ts";
import { checkFtp, checkHrmax } from "./core/fields.ts";
import { answered, awayForm, checkNumbers, initialForm, outcomeOf, submit, typed } from "./core/join.ts";
import type { FieldName, Form } from "./core/join.ts";
import { NOT_LIVE_FOR_MS, startLive, step } from "./core/session.ts";
import type { Event, Live } from "./core/session.ts";
import { liveView } from "./core/view.ts";
import { join } from "./net.ts";
import { joinPage, numbersSheet } from "./render/form.ts";
import type { FormHandlers } from "./render/form.ts";
import { endedPage, refusedPage, removedPage, waitingPage } from "./render/pages.ts";
import { RiderRun } from "./render/run.ts";
import { RiderSocket } from "./socket.ts";
import { forgetNumbers, forgetToken, loadNumbers, loadToken, rememberNumbers, saveToken, storageWorks } from "./store.ts";

const TICK_MS = 250;
const now = (): number => performance.now();

/**
 * The class code in the address, with the address made to hold at most `/j#<code>` (core/address.ts):
 * a query string, a control code or any other fragment is replaced in place, so it stays in neither
 * the address nor the history. `held`, in a class or while joining, is the code the address keeps,
 * which may be none (a class restored with no fragment): then the address holds no code either.
 */
function codeInAddress(held?: { readonly code: string | null }): string | null {
  const a = riderAddress(location.pathname, location.hash);
  const target = held === undefined ? a.target : held.code !== null ? `${location.pathname}#${held.code}` : location.pathname;
  if (location.href !== location.origin + target) history.replaceState(null, "", target);
  return a.join;
}

export class RiderApp {
  private form: Form;
  /** The rider's numbers and nickname: this tab's memory (the numbers also remembered, if asked). */
  private mine: MyNumbers;
  private nickname: string | null = null;
  private live: Live | null = null;
  private socket: RiderSocket | null = null;
  private refused: "not_joined" | "no_connection" | null = null;
  private sheet = false;
  private run: RiderRun | null = null;
  private lastHeard = 0;
  private shown = "";
  /** The class code in the address now (from the fragment, or typed and written there). */
  private address: string | null;
  private readonly host: HTMLElement;
  private readonly wake: ScreenWake;
  private readonly handlers: FormHandlers;

  constructor(host: HTMLElement) {
    // Before anything else: the address keeps the bare class code only.
    this.address = codeInAddress();
    this.host = host;
    this.wake = new ScreenWake(() => this.draw(true));
    const storage = storageWorks();
    const remembered = storage ? loadNumbers() : null;
    this.mine = remembered ?? NO_NUMBERS;
    this.form = initialForm(this.address, storage, remembered);
    this.handlers = {
      typed: (f, t) => this.onTyped(f, t),
      join: () => void this.join(),
      remember: () => this.toggleRemember(),
      forget: () => this.forget(),
      done: () => this.done(),
    };
    setInterval(() => this.tick(), TICK_MS);
    addEventListener("hashchange", () => this.onHash());
    const token = loadToken();
    if (token) this.connect(token);
    this.draw();
    this.focusFirst();
  }

  private onHash(): void {
    // The address is cleaned on every change. In a class or while joining the address holds the
    // code it had and nothing else, so a class restored from the tab's token with no fragment has
    // none, and a bare code typed into the address later is dropped, not kept (the form is not on
    // screen then). Only outside a class does a typed code become the form's.
    const settled = this.live !== null || this.form.busy;
    const code = codeInAddress(settled ? { code: this.address } : undefined);
    if (settled) return;
    this.address = code;
    this.form = { ...this.form, code };
    this.refused = null;
    this.draw();
  }

  private onTyped(field: FieldName, text: string): void {
    const before = JSON.stringify(this.form.errors);
    this.form = typed(this.form, field, text);
    // In My numbers the effort follows a valid number as it is typed (in memory only).
    if (this.sheet && field === "ftp") this.takeNumber(checkFtp(text), (v) => ({ ...this.mine, ftp: v }));
    if (this.sheet && field === "hrmax") this.takeNumber(checkHrmax(text), (v) => ({ ...this.mine, hrmax: v }));
    if (before !== JSON.stringify(this.form.errors)) this.draw();
  }

  private takeNumber(v: number | null | "bad", next: (v: number | null) => MyNumbers): void {
    if (v !== "bad") this.mine = next(v);
  }

  /** Join or Done: the numbers are written only while Remember is on; with it off, what was kept goes. */
  private keep(n: MyNumbers): void {
    const f = this.form;
    if (!f.storage) return;
    if (f.remember) this.form = { ...f, remembered: rememberNumbers(n) };
    else if (f.remembered) {
      forgetNumbers();
      this.form = { ...f, remembered: false };
    }
  }

  private async join(): Promise<void> {
    const hadCode = this.form.code !== null;
    const r = submit(this.form);
    this.form = r.form;
    if (!("send" in r)) return this.draw();
    // A typed code goes into the fragment, so a lapsed rider can join again from this tab.
    if (!hadCode) history.replaceState(null, "", `${location.pathname}#${r.send.session}`);
    this.address = r.send.session;
    this.mine = r.numbers;
    this.nickname = r.send.nickname;
    this.keep(r.numbers);
    this.draw();
    const outcome = outcomeOf(await join(r.send));
    const a = answered(this.form, outcome);
    this.form = a.form;
    if (outcome.kind === "token") this.connect(outcome.token);
    else if (a.next === "not_joined" || a.next === "no_connection") this.refused = a.next;
    this.draw();
  }

  private toggleRemember(): void {
    if (!this.form.storage || this.form.busy) return;
    this.form = { ...this.form, remember: !this.form.remember };
    this.draw();
  }

  /** Forget: both values leave localStorage, the switch goes off and the two fields are cleared. */
  private forget(): void {
    forgetNumbers();
    const errors = { ...this.form.errors };
    delete errors.ftp;
    delete errors.hrmax;
    this.form = { ...this.form, remember: false, remembered: false, typed: { ...this.form.typed, ftp: "", hrmax: "" }, errors };
    this.mine = NO_NUMBERS;
    this.draw();
  }

  private done(): void {
    const c = checkNumbers(this.form);
    if ("errors" in c) {
      this.form = { ...this.form, errors: c.errors };
      return this.draw();
    }
    this.mine = c.numbers;
    this.keep(c.numbers);
    this.sheet = false;
    this.draw();
  }

  private connect(token: string): void {
    saveToken(token);
    this.socket?.stop();
    this.live = startLive();
    this.lastHeard = now();
    const socket = new RiderSocket(token, (e) => this.onEvent(socket, e), now);
    this.socket = socket;
    socket.start();
    this.wake.want(true);
  }

  private onEvent(socket: RiderSocket, e: Event): void {
    if (socket !== this.socket || !this.live) return;
    if (e.type === "message" || e.type === "opened") this.lastHeard = e.at;
    this.live = step(this.live, e);
    if (this.live.welcomed && this.form.busy) this.form = { ...this.form, busy: false };
    if (this.live.gone) this.leave();
    this.draw();
  }

  /** The session is over for this token: removed, ended, or lapsed (back to the form). */
  private leave(): void {
    this.socket?.stop();
    this.socket = null;
    forgetToken();
    this.wake.want(false);
    this.sheet = false;
    if (this.live?.gone === "lapsed") {
      this.live = null;
      this.form = awayForm(this.form);
    }
  }

  private tick(): void {
    const l = this.live;
    if (!l || l.gone) return;
    const at = now();
    // Connected, the instructor in, and nothing heard for 10 s: the connection has gone quiet.
    if (l.conn === "open" && l.hostIn && at - this.lastHeard > NOT_LIVE_FOR_MS) {
      this.lastHeard = at;
      this.socket?.restart();
    }
    this.draw();
  }

  private retry(): void {
    this.refused = null;
    this.draw();
  }

  private focusFirst(): void {
    if (this.live || this.form.busy) return;
    const id = this.form.code === null ? "rider-code" : this.form.remembered ? "rider-nickname" : "";
    if (id) document.getElementById(id)?.focus();
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

  private formKey(kind: string, f: Form): string {
    return JSON.stringify([kind, f.code, f.errors, f.remember, f.remembered, f.storage, f.plate, f.busy]);
  }

  private draw(force = false): void {
    const l = this.live;
    const f = this.form;
    if (!l) {
      if (this.refused) {
        const kind = this.refused;
        return this.mount(`refused:${kind}`, () => refusedPage(kind, f.code, () => this.retry()), force);
      }
      return this.mount(this.formKey("form", f), () => joinPage(f, this.handlers), force);
    }
    const v = liveView(l, now(), this.nickname, this.mine);
    switch (v.kind) {
      case "joining": {
        const busy = { ...f, busy: true };
        return this.mount(this.formKey("joining", busy), () => joinPage(busy, this.handlers), force);
      }
      case "waiting":
        return this.mount(JSON.stringify([v, this.wake.works]), () => waitingPage(v.who, v.down, this.wake.works), force);
      case "removed":
        return this.mount("removed", removedPage, force);
      case "ended":
      case "lapsed":
        return this.mount("ended", endedPage, force);
      case "run":
        if (this.sheet) return this.mount(this.formKey("sheet", f), () => numbersSheet(f, this.handlers), force);
        if (!this.run || this.shown !== "run") {
          const screen = new RiderRun(() => this.openSheet());
          this.mount("run", () => screen.root, true);
          this.run = screen;
        }
        this.run.update(v, this.wake.works);
    }
  }

  private openSheet(): void {
    this.sheet = true;
    this.draw();
  }
}

// Rider mode's page (docs/design/app-rider-join.md, issue #633): the edge that joins flow.ts to the
// DOM and to native code. The page sends native code the class code and the nickname, and nothing
// else; native code holds the rider token, opens the live link and passes on only messages meant
// for a rider (RiderSession.kt). The rider's FTP and maximum heart rate stay in this page's memory,
// and in storage only while "Remember on this phone" is on (numbers.ts). Every ending deletes them
// and opens step 1 with nothing of this rider. Nothing here logs.
import { ScreenWake } from "../../../../web/src/companion/wake.ts";
import { NO_NUMBERS } from "../../../../web/src/rider/core/effort-calc.ts";
import type { MyNumbers } from "../../../../web/src/rider/core/effort-calc.ts";
import { checkFtp, checkHrmax } from "../../../../web/src/rider/core/fields.ts";
import { checkNumbers, typed } from "../../../../web/src/rider/core/join.ts";
import type { FieldName } from "../../../../web/src/rider/core/join.ts";
import { liveView } from "../../../../web/src/rider/core/view.ts";
import { numbersSheet } from "../../../../web/src/rider/render/form.ts";
import type { FormHandlers } from "../../../../web/src/rider/render/form.ts";
import { waitingPage } from "../../../../web/src/rider/render/pages.ts";
import { RiderRun } from "../../../../web/src/rider/render/run.ts";
import type { RiderModePlugin } from "../modes/bridge.ts";
import { endIfOver } from "./ending.ts";
import { ENDING_WORDS, backToCode, continueCode, ended, joinAnswered, joinPressed, keepRiding, onEvent, retry, start } from "./flow.ts";
import type { Flow } from "./flow.ts";
import { NativeLink } from "./link.ts";
import { parseJoinReply } from "./native.ts";
import type { NativeEvent } from "./native.ts";
import { Numbers } from "./numbers.ts";
import { codePage, detailsPage, leavePage, notice, refusedWithTag } from "./pages.ts";
import { ModeStrip } from "./strip.ts";

const TICK_MS = 250;
const now = (): number => performance.now();
const clock = { now, later: (fn: () => void, ms: number) => clearer(setTimeout(fn, ms)) };
const clearer = (t: ReturnType<typeof setTimeout>) => (): void => clearTimeout(t);

export class RiderModeApp {
  private flow: Flow;
  private link: NativeLink | null = null;
  private sheet = false;
  private run: RiderRun | null = null;
  private shown = "";
  private readonly strip: ModeStrip;
  private readonly native: RiderModePlugin;
  private readonly host: HTMLElement;
  private readonly numbers = new Numbers(() => localStorage);
  private readonly wake: ScreenWake;
  private readonly handlers: FormHandlers;

  constructor(native: RiderModePlugin, host: HTMLElement) {
    this.native = native;
    this.host = host;
    this.wake = new ScreenWake(() => this.draw(true));
    const storage = this.numbers.works();
    this.flow = start(storage, storage ? this.numbers.load() : null);
    this.handlers = {
      typed: (f, t) => this.onTyped(f, t),
      join: () => void this.join(),
      remember: () => this.toggleRemember(),
      forget: () => this.forget(),
      done: () => this.done(),
    };
    this.strip = new ModeStrip(native, () => this.draw());
    setInterval(() => this.tick(), TICK_MS);
    this.draw();
    this.focus("rider-code");
  }

  private set(f: Flow, focus?: string): void {
    const was = this.flow;
    this.flow = f;
    if (endIfOver(was, f, this.numbers)) this.over();
    this.draw();
    if (focus) this.focus(focus);
  }

  /** The class is over for this page (any ending): no link, no wake lock (ending.ts deleted the numbers). */
  private over(): void {
    this.link?.stop();
    this.link = null;
    this.wake.want(false);
    this.sheet = false;
  }

  private onTyped(field: FieldName, text: string): void {
    const f = this.flow;
    const before = JSON.stringify(f.form.errors);
    let mine = f.mine;
    if (this.sheet && field === "ftp") mine = this.take(checkFtp(text), (v) => ({ ...mine, ftp: v }));
    if (this.sheet && field === "hrmax") mine = this.take(checkHrmax(text), (v) => ({ ...mine, hrmax: v }));
    this.flow = { ...f, mine, form: typed(f.form, field, text) };
    if (before !== JSON.stringify(this.flow.form.errors)) this.draw();
  }

  private take(v: number | null | "bad", next: (v: number | null) => MyNumbers): MyNumbers {
    return v === "bad" ? this.flow.mine : next(v);
  }

  /** Join or Done: the numbers are written only while Remember is on; with it off, what was kept goes. */
  private keep(n: MyNumbers): void {
    const form = this.flow.form;
    if (!form.storage) return;
    if (form.remember) this.flow = { ...this.flow, form: { ...form, remembered: this.numbers.remember(n) } };
    else if (form.remembered) {
      this.numbers.forget();
      this.flow = { ...this.flow, form: { ...form, remembered: false } };
    }
  }

  private async join(): Promise<void> {
    const r = joinPressed(this.flow);
    this.flow = r.flow;
    if (!r.send) return this.draw();
    this.keep(this.flow.mine);
    this.draw();
    const raw = await this.native.join({ session: r.send.session, nickname: r.send.nickname }).catch(() => null);
    this.set(joinAnswered(this.flow, parseJoinReply(raw)));
    if (this.flow.live && !this.link) this.connect();
  }

  private connect(): void {
    const link = new NativeLink(this.native, (e) => this.onEvent(link, e), clock);
    this.link = link;
    link.start();
    this.wake.want(true);
  }

  private onEvent(link: NativeLink, e: NativeEvent): void {
    if (link !== this.link) return;
    if (e.kind === "back" && this.sheet) {
      this.sheet = false;
      return this.draw();
    }
    const leaving = e.kind === "back" && this.flow.screen === "live";
    this.set(onEvent(this.flow, e, now()), leaving ? "" : undefined);
    if (leaving) this.focusAction("keep_riding");
  }

  /** "Leave": native code closes the link and drops the token; the page opens step 1. */
  private async leave(): Promise<void> {
    this.link?.stop();
    this.link = null;
    await this.native.leave().catch(() => undefined);
    this.set(ended(this.flow, "left"), "rider-code");
  }

  private toggleRemember(): void {
    const form = this.flow.form;
    if (!form.storage || form.busy) return;
    this.flow = { ...this.flow, form: { ...form, remember: !form.remember } };
    this.draw();
  }

  /** Forget: both values leave storage, the switch goes off and the two fields are cleared. */
  private forget(): void {
    this.numbers.forget();
    const form = this.flow.form;
    const errors = { ...form.errors };
    delete errors.ftp;
    delete errors.hrmax;
    this.flow = { ...this.flow, mine: NO_NUMBERS, form: { ...form, remember: false, remembered: false, typed: { ...form.typed, ftp: "", hrmax: "" }, errors } };
    this.draw();
  }

  private done(): void {
    const c = checkNumbers(this.flow.form);
    if ("errors" in c) {
      this.flow = { ...this.flow, form: { ...this.flow.form, errors: c.errors } };
      return this.draw();
    }
    this.flow = { ...this.flow, mine: c.numbers };
    this.keep(c.numbers);
    this.sheet = false;
    this.draw();
  }

  private tick(): void {
    if (this.flow.screen === "live") this.draw();
  }

  private focus(id: string): void {
    document.getElementById(id)?.focus();
  }

  private focusAction(action: string): void {
    this.host.querySelector<HTMLElement>(`[data-action="${action}"]`)?.focus();
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

  private codeStep(force: boolean): void {
    const f = this.flow;
    const words = f.ending ? ENDING_WORDS[f.ending] : null;
    const plates = [...this.strip.plates(), ...(words ? [notice(...words)] : [])];
    const handlers = { typed: (t: string) => this.onTyped("code", t), continue: () => this.set(continueCode(this.flow), "rider-nickname") };
    this.mount(JSON.stringify(["code", f.form.errors, f.ending, this.strip.key]), () => codePage(f.form, handlers, plates, this.strip.nav()), force);
  }

  private draw(force = false): void {
    const f = this.flow;
    const form = f.form;
    const formKey = (kind: string): string => JSON.stringify([kind, form.code, form.errors, form.remember, form.remembered, form.storage, form.plate, form.busy]);
    switch (f.screen) {
      case "code":
        return this.codeStep(force);
      case "details":
        return this.mount(formKey("details"), () => detailsPage(form, this.handlers, () => this.set(backToCode(this.flow), "rider-code")), force);
      case "not_joined":
      case "no_connection": {
        const kind = f.screen;
        return this.mount(`refused:${kind}`, () => refusedWithTag(kind, form.code, () => this.set(retry(this.flow))), force);
      }
      case "leave":
        return this.mount("leave", () => leavePage(() => void this.leave(), () => this.set(keepRiding(this.flow))), force);
      case "live":
        return this.drawLive(force, formKey);
    }
  }

  private drawLive(force: boolean, formKey: (kind: string) => string): void {
    const f = this.flow;
    if (!f.live) return;
    const v = liveView(f.live, now(), f.nickname, f.mine);
    switch (v.kind) {
      case "joining": {
        const busy = { ...f.form, busy: true };
        return this.mount(formKey("joining"), () => detailsPage(busy, this.handlers, () => undefined), force);
      }
      case "waiting":
        return this.mount(JSON.stringify([v, this.wake.works]), () => waitingPage(v.who, v.down, this.wake.works), force);
      case "removed":
      case "ended":
      case "lapsed":
        // flow.ts has already opened step 1 for these; nothing of the class stays on screen.
        return;
      case "run":
        if (this.sheet) return this.mount(formKey("sheet"), () => numbersSheet(f.form, this.handlers), force);
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

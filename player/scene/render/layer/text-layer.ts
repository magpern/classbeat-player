// The text layer's DOM (scene.md "Layout"): HTML over the canvas, built once and then only set by
// text, class and style. It places what `textView` decided (src/text-view-calc.ts) and nothing
// else: no clock, no rule, no colour of its own (a zone's colour is its `z<N>` class, which
// tokens.css defines). `boxes()` measures every line of text over the scene, which is what the
// dark-under-text mask darkens under (S2).

import type { TextBox } from "../src/text-box.ts";
import type { TextView } from "../src/text-view.ts";
import { Pool, make, setClass, setText, show } from "./dom-kit.ts";
import { ScoreLayer } from "./score-layer.ts";

export class TextLayer {
  private readonly root: HTMLElement;
  private readonly ink: HTMLElement[] = [];
  /** What the lines looked like when they were last measured: a frame that changed none of it measures nothing (a measure forces a layout). */
  private signature = "";
  private cached: TextBox[] = [];
  private readonly score: ScoreLayer;
  private readonly gel: { root: HTMLElement; num: HTMLElement; name: HTMLElement; targets: Pool<{ root: HTMLElement }> };
  private readonly rail: { time: HTMLElement; done: HTMLElement; seg: HTMLElement; link: HTMLElement };
  private readonly clock: { label: HTMLElement; paused: HTMLElement; bars: HTMLElement; count: HTMLElement; pause: HTMLElement };
  private readonly metrics: readonly { label: HTMLElement; row: HTMLElement; val: HTMLElement; unit: HTMLElement; fold: HTMLElement; side: HTMLElement; count: HTMLElement; note: HTMLElement }[];
  private readonly pattern: { root: HTMLElement; label: HTMLElement; side: HTMLElement; count: HTMLElement; squares: HTMLElement; boxes: Pool<{ root: HTMLElement }>; note: HTMLElement };
  private readonly cue: { root: HTMLElement; text: HTMLElement };
  private readonly next: { root: HTMLElement; line: HTMLElement; label: HTMLElement; chip: HTMLElement; name: HTMLElement; length: HTMLElement; spec: HTMLElement; cue: HTMLElement };

  constructor(rootId: string) {
    const found = document.getElementById(rootId);
    if (found === null) throw new Error(`the page has no #${rootId} for the text layer`);
    this.root = found;
    const ink = (parent: HTMLElement, tag: "div" | "span", className: string): HTMLElement => {
      const el = make(parent, tag, `${className} ink`);
      this.ink.push(el);
      return el;
    };
    const root = this.root;

    const gelRoot = make(root, "div", "gel");
    const gelHead = make(gelRoot, "div", "gel-head");
    setText(make(gelHead, "span", "lbl"), "Zone");
    const [gelNum, gelName] = [make(gelHead, "span", "gel-num n"), make(gelRoot, "div", "gel-name")];
    const gelTargets = make(gelRoot, "div", "gel-targets");
    this.gel = { root: gelRoot, num: gelNum, name: gelName, targets: new Pool(() => ({ root: make(gelTargets, "span", "") })) };

    const rail = make(root, "div", "rail");
    const [time, done] = [ink(rail, "span", "t"), ink(rail, "span", "t")];
    make(rail, "span", "grow");
    this.rail = { time, done, seg: ink(rail, "span", "seg"), link: ink(rail, "span", "link") };

    const metrics = make(root, "div", "metrics");
    this.metrics = [0, 1, 2].map(() => {
      const m = make(metrics, "div", "metric");
      const label = ink(m, "div", "m-label lbl");
      const row = ink(m, "div", "m-row");
      const fold = ink(m, "div", "m-fold");
      return {
        label, row, val: make(row, "span", "m-val n"), unit: make(row, "span", "m-unit"), fold,
        side: make(fold, "span", "side n"), count: make(fold, "span", "count n"), note: ink(m, "div", "m-note"),
      };
    });

    const clock = make(root, "div", "clock");
    const head = make(clock, "div", "c-head");
    this.clock = {
      label: ink(head, "span", "lbl"), paused: make(head, "span", "c-paused"), pause: ink(head, "span", "c-pause"), bars: ink(head, "span", "c-bars"),
      count: ink(clock, "div", "c-count n"),
    };

    const pattern = make(root, "div", "pattern");
    const plabel = ink(pattern, "div", "p-label");
    const prow = ink(pattern, "div", "p-row");
    const squares = ink(pattern, "div", "p-squares");
    this.pattern = {
      root: pattern, label: plabel, side: make(prow, "span", "p-side n"), count: make(prow, "span", "p-count n"),
      squares, boxes: new Pool(() => ({ root: make(squares, "span", "") })), note: ink(pattern, "div", "p-note"),
    };

    const cue = make(root, "div", "cue");
    this.cue = { root: cue, text: ink(cue, "div", "") };

    const next = make(root, "div", "next");
    const line = ink(next, "div", "n-line");
    this.next = {
      root: next, line, label: make(line, "span", ""), chip: make(line, "span", "chip"), name: make(line, "span", ""), length: make(line, "span", "n"), spec: make(line, "span", ""),
      cue: ink(next, "div", "n-cue"),
    };

    this.score = new ScoreLayer(make(root, "div", "score"));
  }

  update(view: TextView): void {
    setClass(this.root, `${view.layout}${view.reduced ? " rm" : ""}`);
    this.updateGel(view);
    this.updateRail(view);
    this.updateClock(view);
    this.updateMetrics(view);
    this.updatePattern(view);
    setClass(this.cue.root, `cue${view.cue.small ? " small" : ""}`);
    setText(this.cue.text, view.cue.text);
    this.updateNext(view);
    this.score.update(view.score);
  }

  private updateGel({ gel }: TextView): void {
    setClass(this.gel.root, `gel z${gel.zone}${gel.look === "down" ? " down" : ""}`);
    setText(this.gel.num, gel.numeral);
    setText(this.gel.name, gel.name);
    setClass(this.gel.name, `gel-name${gel.nameSmall ? " small" : ""}`);
    this.gel.targets.use(gel.targets.length).forEach((n, i) => setText(n.root, gel.targets.at(i) ?? ""));
  }

  private updateRail({ rail }: TextView): void {
    setText(this.rail.time, rail.left);
    setText(this.rail.done, rail.done);
    setText(this.rail.seg, rail.segment ?? "");
    show(this.rail.seg, rail.segment !== null);
    setText(this.rail.link, rail.link.text);
    setClass(this.rail.link, `link ink${rail.link.alert ? " alert" : ""}`);
  }

  private updateClock({ clock }: TextView): void {
    setText(this.clock.label, clock.label);
    show(this.clock.label, !clock.paused);
    setText(this.clock.paused, "Paused");
    show(this.clock.paused, clock.paused);
    setText(this.clock.bars, clock.bars ?? "");
    show(this.clock.bars, clock.bars !== null);
    setText(this.clock.count, clock.count);
    setClass(this.clock.count, `c-count n ink${clock.estimated ? " est" : ""}`);
    setText(this.clock.pause, clock.pauseLine ?? "");
    show(this.clock.pause, clock.pauseLine !== null);
  }

  private updateMetrics({ metrics }: TextView): void {
    this.metrics.forEach((n, i) => {
      const m = metrics.at(i);
      if (m === undefined) return;
      const state = m.folded;
      setText(n.label, m.label);
      setText(n.val, m.value);
      setText(n.unit, m.unit ?? "");
      show(n.unit, m.unit !== null);
      show(n.row, state === null);
      show(n.fold, state !== null && state.kind !== "note");
      show(n.note, state !== null && state.kind !== "count");
      show(n.count, state?.kind === "count");
      setText(n.side, state === null || state.kind === "note" ? "" : state.side);
      setText(n.count, state?.kind === "count" ? String(state.left) : "");
      setText(n.note, state === null || state.kind === "count" ? "" : state.text);
    });
  }

  private updatePattern({ pattern }: TextView): void {
    show(this.pattern.root, pattern !== null);
    if (pattern === null) return;
    const { state } = pattern;
    setClass(this.pattern.root, `pattern${pattern.compact ? " compact" : ""}`);
    setText(this.pattern.label, pattern.label);
    show(this.pattern.side, state.kind !== "note");
    show(this.pattern.count, state.kind === "count");
    setText(this.pattern.side, state.kind === "note" ? "" : state.side);
    setText(this.pattern.count, state.kind === "count" ? String(state.left) : "");
    const total = pattern.squares?.total ?? 0;
    this.pattern.boxes.use(total).forEach((n, i) => setClass(n.root, i < (pattern.squares?.left ?? 0) ? "on" : ""));
    show(this.pattern.squares, pattern.squares !== null);
    setText(this.pattern.note, state.kind === "count" ? state.then : state.text);
  }

  private updateNext({ next }: TextView): void {
    setText(this.next.label, next.end ? "" : "Next");
    show(this.next.chip, !next.end);
    setClass(this.next.chip, `chip z${next.zone}`);
    setText(this.next.chip, String(next.zone));
    setText(this.next.name, next.zoneName);
    setText(this.next.length, next.length);
    show(this.next.length, !next.end);
    setText(this.next.spec, next.spec ?? "");
    show(this.next.spec, next.spec !== null);
    this.next.root.style.left = `${next.leftVw.toFixed(2)}vw`;
    this.next.line.style.fontSize = `${next.sizeVh}vh`;
    setText(this.next.cue, next.cue ?? "");
    show(this.next.cue, next.cue !== null && next.cueLines > 0);
    setClass(this.next.cue, `n-cue ink l${next.cueLines}`);
  }

  /** Measure again next time (the fonts finished loading, or a stylesheet changed a size). */
  invalidate(): void {
    this.signature = "";
  }

  /**
   * The box of every line of text over the scene now showing, in CSS pixels (the gel and the score
   * are opaque and are not here). The same array comes back while no line changed.
   */
  boxes(): TextBox[] {
    const signature = `${window.innerWidth}x${window.innerHeight}|${this.root.className}|${this.ink.map((el) => `${el.hidden ? "-" : el.className}:${el.textContent}`).join("|")}`;
    if (signature === this.signature) return this.cached;
    this.signature = signature;
    this.cached = this.ink.flatMap((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? [{ left: r.left, top: r.top, right: r.right, bottom: r.bottom }] : [];
    });
    return this.cached;
  }
}

// The score's DOM (scene.md "The score"): flat, opaque blocks and clips placed by the view's vw
// positions. It draws what `scoreView` decided and decides nothing: which labels fit, which blocks
// are neutral or cut, and where "now" is, are all in src/text-score-calc.ts.

import type { IntervalBlock, ScoreView, SongClip, Strip } from "../src/text-view.ts";
import { Pool, bgPos, bgSize, make, setClass, setText, show, vw } from "./dom-kit.ts";

interface BlockNodes { readonly root: HTMLElement; readonly txt: HTMLElement; readonly num: HTMLElement; readonly len: HTMLElement; readonly name: HTMLElement; readonly detail: HTMLElement; readonly strip: HTMLElement }
interface ClipNodes { readonly root: HTMLElement; readonly txt: HTMLElement; readonly title: HTMLElement; readonly detail: HTMLElement }
interface MarkNodes { readonly root: HTMLElement; readonly word: HTMLElement }


/** `linear-gradient` with hard stops: dark on the "up" beats, clear on the "down" beats (scene.md "Intervals first"). */
export function stripGradient(strip: Strip): string {
  const pct = (f: number): string => `${(f * 100).toFixed(2)}%`;
  const stops = strip.parts.map((p) => `${p.up ? "var(--ink)" : "transparent"} ${pct(p.from)} ${pct(p.to)}`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export class ScoreLayer {
  private readonly now: HTMLElement;
  private readonly end: HTMLElement;
  private readonly blocks: Pool<BlockNodes>;
  private readonly clips: Pool<ClipNodes>;
  private readonly marks: Pool<MarkNodes>;
  private readonly phrases: Pool<{ readonly root: HTMLElement }>;

  constructor(score: HTMLElement) {
    const ivLane = make(score, "div", "lane-iv");
    const songLane = make(score, "div", "lane-song");
    this.blocks = new Pool(() => {
      const root = make(ivLane, "div", "blk");
      const txt = make(root, "div", "txt");
      const l1 = make(txt, "div", "l1");
      return { root, txt, num: make(l1, "span", "bn n"), len: make(l1, "span", "bl"), name: make(l1, "span", "bname"), detail: make(txt, "div", "l2"), strip: make(root, "div", "strip") };
    });
    this.clips = new Pool(() => {
      const root = make(songLane, "div", "clip");
      const txt = make(root, "div", "txt");
      return { root, txt, title: make(txt, "span", "ct"), detail: make(txt, "span", "cd") };
    });
    this.marks = new Pool(() => {
      const root = make(songLane, "div", "tick");
      return { root, word: make(root, "span", "") };
    });
    this.phrases = new Pool(() => ({ root: make(songLane, "div", "phrase") }));
    this.end = make(score, "div", "end");
    this.now = make(score, "div", "now");
  }

  update(view: ScoreView): void {
    this.now.style.left = vw(view.nowX);
    show(this.end, view.endX !== null);
    if (view.endX !== null) this.end.style.left = vw(view.endX);
    this.blocks.use(view.intervals.length).forEach((n, i) => this.block(n, view.intervals.at(i)));
    this.clips.use(view.songs.length).forEach((n, i) => this.clip(n, view.songs.at(i)));
    const moments = view.songs.flatMap((s) => s.moments);
    this.marks.use(moments.length).forEach((n, i) => {
      const m = moments.at(i);
      if (m === undefined) return;
      n.root.style.left = vw(m.x);
      setText(n.word, m.word);
    });
    const ticks = view.songs.flatMap((s) => s.ticks);
    this.phrases.use(ticks.length).forEach((n, i) => { n.root.style.left = vw(ticks.at(i) ?? 0); });
  }

  private block(n: BlockNodes, b: IntervalBlock | undefined): void {
    if (b === undefined) return;
    setClass(n.root, `blk z${b.zone}${b.kind === "zone" ? "" : ` ${b.kind}`}`);
    n.root.style.left = vw(b.x0);
    n.root.style.width = vw(b.x1 - b.x0);
    show(n.txt, b.kind === "zone");
    n.txt.style.left = vw(b.textLeft - b.x0);
    n.txt.style.width = vw(Math.max(0, b.textRight - b.textLeft));
    setText(n.num, b.number ?? "");
    setText(n.len, b.length ?? "");
    setText(n.name, b.name ?? "");
    setText(n.detail, b.detail ?? "");
    show(n.detail, b.detail !== null);
    show(n.strip, b.strip !== null);
    if (b.strip !== null) {
      n.strip.style.backgroundImage = stripGradient(b.strip);
      n.strip.style.backgroundSize = bgSize(b.strip.cycleVw);
      n.strip.style.backgroundPosition = bgPos(b.strip.offsetVw);
    }
  }

  private clip(n: ClipNodes, c: SongClip | undefined): void {
    if (c === undefined) return;
    n.root.style.left = vw(c.x0);
    n.root.style.width = vw(c.x1 - c.x0);
    n.txt.style.left = vw(c.textLeft - c.x0);
    n.txt.style.width = vw(Math.max(0, c.textRight - c.textLeft));
    setText(n.title, c.title);
    setText(n.detail, c.detail ?? "");
  }
}

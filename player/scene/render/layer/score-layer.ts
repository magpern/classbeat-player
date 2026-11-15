// The score's DOM (scene.md "The score"): flat, opaque blocks and clips placed by the view's vw
// positions. It draws what `scoreView` decided and decides nothing: which labels fit, which blocks
// are neutral or cut, and where "now" is, are all in src/text-score-calc.ts.

import type { IntervalBlock, ScoreView, SongClip } from "../src/text-view.ts";
import { setLeft, setStrip, setWidth } from "./dom-kit.ts";
import { Pool, make, setClass, setText, show } from "./nodes.ts";

interface BlockNodes { readonly root: HTMLElement; readonly txt: HTMLElement; readonly num: HTMLElement; readonly len: HTMLElement; readonly name: HTMLElement; readonly detail: HTMLElement; readonly strip: HTMLElement }
interface ClipNodes { readonly root: HTMLElement; readonly txt: HTMLElement; readonly title: HTMLElement; readonly detail: HTMLElement }
interface MarkNodes { readonly root: HTMLElement; readonly word: HTMLElement }


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
    setLeft(this.now, view.nowX, 3);
    show(this.end, view.endX !== null);
    if (view.endX !== null) setLeft(this.end, view.endX, 3);
    this.blocks.use(view.intervals.length).forEach((n, i) => this.block(n, view.intervals.at(i)));
    this.clips.use(view.songs.length).forEach((n, i) => this.clip(n, view.songs.at(i)));
    const moments = view.songs.flatMap((s) => s.moments);
    this.marks.use(moments.length).forEach((n, i) => {
      const m = moments.at(i);
      if (m === undefined) return;
      setLeft(n.root, m.x, 3);
      setText(n.word, m.word);
    });
    const ticks = view.songs.flatMap((s) => s.ticks);
    this.phrases.use(ticks.length).forEach((n, i) => { setLeft(n.root, ticks.at(i) ?? 0, 3); });
  }

  private block(n: BlockNodes, b: IntervalBlock | undefined): void {
    if (b === undefined) return;
    setClass(n.root, `blk z${b.zone}${b.kind === "zone" ? "" : ` ${b.kind}`}`);
    setLeft(n.root, b.x0, 3);
    setWidth(n.root, b.x1 - b.x0, 3);
    show(n.txt, b.kind === "zone");
    setLeft(n.txt, b.textLeft - b.x0, 3);
    setWidth(n.txt, Math.max(0, b.textRight - b.textLeft), 3);
    setText(n.num, b.number ?? "");
    setText(n.len, b.length ?? "");
    setText(n.name, b.name ?? "");
    setText(n.detail, b.detail ?? "");
    show(n.detail, b.detail !== null);
    show(n.strip, b.strip !== null);
    if (b.strip !== null) {
      setStrip(n.strip, b.strip.cycleVw, b.strip.offsetVw, b.strip.parts);
    }
  }

  private clip(n: ClipNodes, c: SongClip | undefined): void {
    if (c === undefined) return;
    setLeft(n.root, c.x0, 3);
    setWidth(n.root, c.x1 - c.x0, 3);
    setLeft(n.txt, c.textLeft - c.x0, 3);
    setWidth(n.txt, Math.max(0, c.textRight - c.textLeft), 3);
    setText(n.title, c.title);
    setText(n.detail, c.detail ?? "");
  }
}

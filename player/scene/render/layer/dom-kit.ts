// The only way the text layer makes a node: a `div` or a `span`, set by text, class and style, never
// by markup, source or link (eslint.config.js fences this directory: `createElement` takes only
// those two literals, and no `innerHTML`, `setAttribute`, `src` or `href` is reachable).

export type Tag = "div" | "span";

export function make(parent: HTMLElement, tag: Tag, className: string): HTMLElement {
  const el = tag === "div" ? document.createElement("div") : document.createElement("span");
  el.className = className;
  parent.appendChild(el);
  return el;
}

/** Sets the text only when it changed, so a frame that changes nothing touches nothing. */
export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el: HTMLElement, className: string): void {
  if (el.className !== className) el.className = className;
}

export function show(el: HTMLElement, on: boolean): void {
  if (el.hidden === on) el.hidden = !on;
}

/** Parts of one kind, built when first needed and reused: `use(n)` shows the first n and hides the rest. */
export class Pool<T extends { readonly root: HTMLElement }> {
  private readonly parts: T[] = [];
  private readonly build: () => T;

  constructor(build: () => T) {
    this.build = build;
  }

  use(count: number): T[] {
    while (this.parts.length < count) this.parts.push(this.build());
    this.parts.forEach((p, i) => show(p.root, i < count));
    return this.parts.slice(0, count);
  }
}

// The only values the layer writes to a node's style, each built here from a number: a share of the
// window, a size, a gradient. eslint.config.js lets `style.<property>` be assigned only a direct call
// of one of these, so no other string can reach a style (and none can spell a url).
export const vw = (n: number): string => `${n.toFixed(3)}vw`;
export const vw2 = (n: number): string => `${n.toFixed(2)}vw`;
export const vh = (n: number): string => `${n}vh`;
export const bgSize = (n: number): string => `${vw(n)} 100%`;
export const bgPos = (n: number): string => `${vw(n)} 0`;

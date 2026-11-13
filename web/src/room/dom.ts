// DOM helpers. Text is only ever set with textContent: nothing from a class file becomes markup.

export interface Attrs {
  readonly class?: string;
  /** Type tier: the checks (docs/design/room-2d.md, C1 to C4) read it. */
  readonly tier?: "hero" | "gel" | "value" | "text" | "minor" | "label";
  /** The element may take up to this many lines (default: one). */
  readonly lines?: number;
  /** The element ends in an ellipsis after this many lines by design. */
  readonly clamp?: number;
  /** The element is shown only if it fits whole (the markup wraps it onto a hidden row). */
  readonly fit?: "hide";
  readonly text?: string;
  readonly style?: Readonly<Record<string, string>>;
}

export type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs.class) e.className = attrs.class;
  if (attrs.tier) e.dataset.tier = attrs.tier;
  if (attrs.lines !== undefined) e.dataset.lines = String(attrs.lines);
  if (attrs.clamp !== undefined) e.dataset.clamp = String(attrs.clamp);
  if (attrs.fit) e.dataset.fit = attrs.fit;
  if (attrs.text !== undefined) e.textContent = attrs.text;
  for (const [k, v] of Object.entries(attrs.style ?? {})) e.style.setProperty(k, v);
  for (const c of children) e.append(c);
  return e;
}

/**
 * A running number: each digit sits in a cell as wide as the widest digit of the face, so the
 * number never shifts sideways as it runs (system.md, Type). Other characters stay as text.
 */
export function digits(text: string): Node[] {
  const out: Node[] = [];
  let run = "";
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") {
      if (run) out.push(document.createTextNode(run));
      run = "";
      out.push(el("span", { class: "d", text: ch }));
    } else run += ch;
  }
  if (run) out.push(document.createTextNode(run));
  return out;
}

export function vw(n: number): string {
  return `${n}vw`;
}

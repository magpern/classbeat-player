export interface Item {
  i: number;
  tier: "hero" | "gel" | "value" | "text" | "minor" | "label";
  text: string;
  cap: number;
  colors: number[][];
  box: { x0: number; y0: number; x1: number; y1: number };
  problems: string[];
  lines: number;
  anc: number[];
  ink?: { x0: number; y0: number; x1: number; y1: number } | null;
  worst?: number;
}
export interface ZoneItem {
  z: string;
  num: string;
  name: string;
  problem: string;
}
export interface Collected {
  items: Item[];
  zones: ZoneItem[];
  hues: string[];
  loose: string[];
}
export default function collect(): Collected;

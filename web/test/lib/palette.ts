// Palette check C9 (docs/design/system.md, "Zone gels"), read from tokens.css. Pure.
// Ported from docs/design/mockups/palette.js. For every zone: black on it, it on the stage and it
// on the "lights down" gel (6 % of the zone in black) are each at least 7 : 1. For every pair of
// neighbouring zones: the colour difference (CIE76 delta E) under simulated colour vision
// deficiency (Machado, Oliveira and Fernandes 2009, full severity) is at least the minimum below.

type Rgb = [number, number, number];
type Kind = "normal" | "protan" | "deutan" | "tritan";

export const MIN_DELTA_E: Record<Kind, number> = { normal: 30, protan: 25, deutan: 25, tritan: 12 };
export const MIN_CONTRAST = 7;
const DOWN = 0.06;
const M: Record<Exclude<Kind, "normal">, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (rgb: Rgb): number => {
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function lab(rgb: number[]): number[] {
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v)));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function seen(rgb: Rgb, kind: Kind): number[] {
  const l = rgb.map(lin);
  if (kind === "normal") return lab(l);
  return lab(M[kind].map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
}

const dE = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface PaletteRow {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
}

export function checkPalette(css: string): PaletteRow[] {
  const zones = [...css.matchAll(/--zone-(\d):\s*(#[0-9a-f]{6})/gi)].map((m) => ({ n: m[1], hex: m[2] }));
  const stage = hex(css.match(/--stage:\s*(#[0-9a-f]{6})/i)?.[1] ?? "#000000");
  const rows: PaletteRow[] = [];
  for (const z of zones) {
    const c = hex(z.hex);
    const down = c.map((v, i) => Math.round(v * DOWN + stage[i] * (1 - DOWN))) as Rgb;
    const vals = { "black on it": contrast([0, 0, 0], c), "on stage": contrast(c, stage), "on lights down": contrast(c, down) };
    const bad = Object.entries(vals).filter(([, v]) => v < MIN_CONTRAST);
    rows.push({ check: `zone ${z.n} ${z.hex}`, ok: bad.length === 0, detail: Object.entries(vals).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ") });
  }
  for (const kind of Object.keys(MIN_DELTA_E) as Kind[]) {
    const d = zones.slice(1).map((z, i) => dE(seen(hex(zones[i].hex), kind), seen(hex(z.hex), kind)));
    const min = Math.min(...d);
    rows.push({ check: `neighbours, ${kind}`, ok: min >= MIN_DELTA_E[kind], detail: `min ${min.toFixed(1)} (needs ${MIN_DELTA_E[kind]}): ${d.map((v) => v.toFixed(1)).join(" ")}` });
  }
  return rows;
}

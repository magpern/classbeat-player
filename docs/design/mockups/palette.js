// Palette check (system.md, "Zone gels"), read from tokens.css. Pure: no browser needed.
//   node docs/design/mockups/palette.js
// For every zone: black on it, it on the stage, and it on the "lights down" gel (6 % of the
// zone in black) are each at least 7 : 1. For every pair of neighbouring zones: the colour
// difference (CIE76 delta E) under simulated colour vision deficiency (Machado, Oliveira and
// Fernandes 2009, full severity) is at least the minimum below, so neighbours stay apart as
// colour even though the number and name always say which zone it is.
'use strict';
const fs = require('fs');
const path = require('path');

const MIN = { normal: 30, protan: 25, deutan: 25, tritan: 12 };
const CONTRAST = 7;
const DOWN = 0.06;
const M = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function lab([r, g, b]) {
  [r, g, b] = [r, g, b].map((v) => Math.min(1, Math.max(0, v)));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function seen(rgb, kind) {
  const l = rgb.map(lin);
  if (kind === 'normal') return lab(l);
  return lab(M[kind].map((row) => row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function checkPalette(file = path.join(__dirname, 'tokens.css')) {
  const css = fs.readFileSync(file, 'utf8');
  const zones = [...css.matchAll(/--zone-(\d):\s*(#[0-9a-f]{6})/gi)].map((m) => ({ n: m[1], hex: m[2] }));
  const stage = hex((css.match(/--stage:\s*(#[0-9a-f]{6})/i) || [, '#000000'])[1]);
  const rows = [];
  let failed = 0;
  for (const z of zones) {
    const c = hex(z.hex);
    const down = c.map((v, i) => Math.round(v * DOWN + stage[i] * (1 - DOWN)));
    const vals = { ink: ratio([0, 0, 0], c), stage: ratio(c, stage), down: ratio(c, down) };
    const bad = Object.entries(vals).filter(([, v]) => v < CONTRAST).map(([k]) => k);
    failed += bad.length ? 1 : 0;
    rows.push({ check: `zone ${z.n} ${z.hex}`, values: `black on it ${vals.ink.toFixed(1)}, on stage ${vals.stage.toFixed(1)}, on lights down ${vals.down.toFixed(1)}`, result: bad.length ? `FAIL below ${CONTRAST}: ${bad.join(', ')}` : 'ok' });
  }
  for (const kind of Object.keys(MIN)) {
    const d = zones.slice(1).map((z, i) => dE(seen(hex(zones[i].hex), kind), seen(hex(z.hex), kind)));
    const min = Math.min(...d);
    failed += min < MIN[kind] ? 1 : 0;
    rows.push({ check: `neighbours, ${kind}`, values: d.map((v) => v.toFixed(1)).join(' '), result: min < MIN[kind] ? `FAIL min ${min.toFixed(1)} < ${MIN[kind]}` : `ok (min ${min.toFixed(1)})` });
  }
  return { rows, failed };
}

module.exports = { checkPalette };

if (require.main === module) {
  const { rows, failed } = checkPalette();
  console.table(rows);
  process.exit(failed ? 1 : 0);
}

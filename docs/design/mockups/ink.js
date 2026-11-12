// The ink of one text element, worked out inside a blank probe page (page.evaluate), so only
// the result crosses to Node: two PNGs of the same clip, without any text and with this
// element's text alone. The pixels that differ by more than INK (sum of the RGB differences)
// are its ink; the worst WCAG 2 contrast is between the text colours and every background
// pixel inside the ink box.
//
// INK is 90, not 30: Chromium repaints anti-aliased rounded corners (the tag's outline) with
// differences of about 45 between two screenshots. A higher threshold shrinks a light-on-dark
// ink box by about a pixel at its anti-aliased edges; the PL4 CI check should state its own.
'use strict';

const INK = 90;

module.exports = async function ink([bgB64, oneB64, colors, threshold]) {
  const load = async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
  };
  const bg = await load(bgB64), one = await load(oneB64);
  const w = bg.width, h = bg.height, a = one.data, b = bg.data;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const k = (y * w + x) * 4;
      if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > threshold) mask[y * w + x] = 1;
    }
  }
  // A lone differing pixel is repaint noise on a neighbour's anti-aliased corner (a plate's
  // rounded corner), not text: glyph ink always comes as connected strokes.
  const near = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) return true;
    }
    return false;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x] || !near(x, y)) continue;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
    }
  }
  if (x1 < 0) return null;
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (r, g, bb) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb);
  const text = colors.map(([r, g, bb]) => lum(r, g, bb));
  let worst = Infinity;
  const seen = new Set();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const k = (y * w + x) * 4;
      const key = (b[k] << 16) | (b[k + 1] << 8) | b[k + 2];
      if (seen.has(key)) continue;
      seen.add(key);
      const L = lum(b[k], b[k + 1], b[k + 2]);
      for (const T of text) {
        const r = (Math.max(T, L) + 0.05) / (Math.min(T, L) + 0.05);
        if (r < worst) worst = r;
      }
    }
  }
  return { box: { x0, y0, x1, y1 }, worst };
};

module.exports.INK = INK;

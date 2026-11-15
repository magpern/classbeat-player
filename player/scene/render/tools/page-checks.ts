// What the browser run measures on the text layer, as scripts run in the page (strings, so that the
// test runner's own transforms cannot change them): the cap heights (S1), the colour of every line
// over the scene (S2, S12), the safe area (S15), overlaps (S16) and the light under the text (S2).
// Each returns a list of failures, empty when the check holds.

/** The minimum cap height of each text tier as a share of the window height (scene.md S1). */
export const TIERS: readonly (readonly [string, number, string])[] = [
  [".c-count", 0.2, "countdown"],
  [".gel-name:not(.small)", 0.055, "zone name"],
  [".gel-name.small", 0.03, "zone name, stepped down"],
  [".m-val", 0.055, "metric value"],
  [".m-fold .side, .p-side", 0.055, "pattern side"],
  [".p-count, .m-fold .count", 0.1, "pattern beat count"],
  [".cue .ink, .rail .t, .n-line", 0.03, "cue, class time, next row"],
  [".lbl, .link, .m-unit, .m-note, .p-label, .p-note, .c-pause, .c-bars, .n-cue, .seg", 0.02, "labels"],
  [".bn, .bl, .bname, .l2, .ct, .cd, .tick span", 0.02, "score text"],
];
export const NUMERAL_MIN = { wide: 0.25, narrow: 0.22 } as const;

const HELPERS = `
const root = document.getElementById("text");
const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
const ctx2d = document.createElement("canvas").getContext("2d");
const capShare = (el) => { const cs = getComputedStyle(el); ctx2d.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily; return ctx2d.measureText("H").actualBoundingBoxAscent / innerHeight; };
const clip = (el, r) => {
  let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
  for (let a = el; a && a !== root.parentElement; a = a.parentElement) {
    if (getComputedStyle(a).overflow === "visible") continue;
    const c = a.getBoundingClientRect();
    [l, t, rr, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(rr, c.right), Math.min(b, c.bottom)];
  }
  return rr > l && b > t ? { left: l, top: t, right: rr, bottom: b } : null;
};
/** The ink of each text node: its line boxes, cut to the glyphs' own height (a font's content area is taller than its ink), and to the clip of its own box. */
/** The opaque plates: text on them is on a fill of its own. Every other text node is over the scene. */
const OPAQUE = ".gel, .score, .c-paused, .chip, .link.alert";
const texts = () => {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    const text = n.textContent.trim();
    if (!text || !vis(el)) continue;
    const cs = getComputedStyle(el);
    ctx2d.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    const m = ctx2d.measureText(text);
    const range = document.createRange();
    range.selectNodeContents(n);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    if (lines.length === 0) continue;
    const box = {
      left: Math.min(...lines.map((r) => r.left)), right: Math.max(...lines.map((r) => r.right)),
      top: Math.min(...lines.map((r) => r.top)) + m.fontBoundingBoxAscent - m.actualBoundingBoxAscent,
      bottom: Math.max(...lines.map((r) => r.top)) + m.fontBoundingBoxAscent + m.actualBoundingBoxDescent,
    };
    const r = clip(el, box);
    // Cut: the clip of its own box took away some of its height (an intended ellipsis is a line clamp, which hides whole lines).
    const clamped = getComputedStyle(el).webkitLineClamp !== "none";
    if (r) out.push({ el, text, rect: r, score: !!el.closest(".score"), over: !el.closest(OPAQUE), cut: !clamped && (box.bottom - r.bottom > 1.5 || r.top - box.top > 1.5) });
  }
  return out;
};
`;

/** S1: every tier meets its floor, measured with the page's own faces at the page's own size. */
export const capsScript = (narrow: boolean): string => `(async () => {
  ${HELPERS}
  await document.fonts.ready;
  const tiers = ${JSON.stringify(TIERS)};
  const bad = [];
  const check = (el, min, what) => { const cap = capShare(el); if (vis(el) && cap + 1e-6 < min) bad.push(what + ": " + (cap * 100).toFixed(2) + " % under " + (min * 100) + " % (" + el.textContent.slice(0, 20) + ")"); };
  for (const [sel, min, what] of tiers) for (const el of root.querySelectorAll(sel)) check(el, min, what);
  for (const el of root.querySelectorAll(".gel-num")) check(el, ${narrow ? NUMERAL_MIN.narrow : NUMERAL_MIN.wide}, "zone numeral");
  return bad;
})()`;

/** S2 and S12: every text node over the scene is --light-1 (the opaque plates carry ink on their own fill). */
export const coloursScript = `(() => {
  ${HELPERS}
  const probe = document.createElement("div");
  probe.style.color = "var(--light-1)";
  root.appendChild(probe);
  const want = getComputedStyle(probe).color;
  probe.remove();
  const bad = [];
  // Every text node over the scene, found by walking the DOM, whatever built it: not only the lines the layer registered.
  for (const t of texts()) {
    if (!t.over) continue;
    const c = getComputedStyle(t.el).color;
    if (c !== want) bad.push("not --light-1: " + t.text.slice(0, 20) + " " + c);
  }
  return bad;
})()`;

/** S15: all text ink within 5 % of every edge, with the clip of its own box. */
export const safeAreaScript = `(() => {
  ${HELPERS}
  const [w, h] = [innerWidth, innerHeight];
  const tol = 1;
  return texts().filter(({ rect: r }) => r.left < 0.05 * w - tol || r.right > 0.95 * w + tol || r.top < 0.05 * h - tol || r.bottom > 0.95 * h + tol)
    .map(({ text, rect: r }) => "outside the safe area: " + text.slice(0, 24) + " [" + [r.left, r.top, r.right, r.bottom].map(Math.round) + "]");
})()`;

/** S16: no two pieces of text over the scene or the gel overlap, and none is cut off by the box that holds it (the score's blocks are checked among themselves). */
export const overlapScript = `(() => {
  ${HELPERS}
  const all = texts();
  const bad = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const [a, b] = [all[i], all[j]];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || a.score !== b.score) continue;
    const [x, y] = [Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left), Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)];
    if (x > 0.5 && y > 0.5) bad.push("overlap: " + a.text.slice(0, 18) + " / " + b.text.slice(0, 18));
  }
  for (const t of all) if (t.cut) bad.push("cut off: " + t.text.slice(0, 24));
  return bad;
})()`;

/** Sets up the light measurement: `__lum.sample()` reads what the canvas holds under every text box grown by 1.2 vh (S2). */
/** S2: every text node over the scene lies inside a box the mask darkens under (found by the DOM walk, not by the layer's own list). */
export const maskCoverScript = `(() => {
  ${HELPERS}
  const boxes = window.__scene.text.boxes();
  const tol = 1;
  return texts().filter((t) => t.over && !boxes.some((b) => t.rect.left >= b.left - tol && t.rect.right <= b.right + tol && t.rect.top >= b.top - tol && t.rect.bottom <= b.bottom + tol))
    .map((t) => "no mask box under: " + t.text.slice(0, 24));
})()`;

export const lumSetup = `(() => {
  ${HELPERS}
  const side = 480;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  window.__lum = {
    max: 0, frames: 0, worst: "",
    sample(label) {
      const src = document.getElementById("scene");
      const [w, h] = [innerWidth, innerHeight];
      cv.width = side; cv.height = Math.round(side * h / w);
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const g = 0.012 * h, k = side / w;
      let frameMax = 0;
      for (const t of texts()) {
        if (!t.over) continue;
        const b = t.rect;
        const [x0, y0, x1, y1] = [Math.max(0, Math.ceil((b.left - g) * k)), Math.max(0, Math.ceil((b.top - g) * k)), Math.min(cv.width, Math.floor((b.right + g) * k)), Math.min(cv.height, Math.floor((b.bottom + g) * k))];
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = (y * cv.width + x) * 4;
          frameMax = Math.max(frameMax, 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]));
        }
      }
      this.frames++;
      if (frameMax > this.max) { this.max = frameMax; this.worst = label; }
    },
    /** Plays the class from \`from\` to \`to\` seconds at 60 fps, drawing and measuring every third frame. */
    run(from, to, what) {
      let n = 0;
      const self = this;
      window.__scene.advance(from * 1000, to * 1000, 60, { draws: () => n++ % 3 === 0, after: (ms) => self.sample(what + " at " + (ms / 1000).toFixed(1) + " s") });
    },
  };
})()`;

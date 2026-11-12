// The measurable checks of docs/design/room-2d.md, run on every room mock-up:
//   node docs/design/mockups/measure.js        (ONLY=<regex> limits it to some screenshots)
// Prints one table per screenshot and exits 1 if any check fails.
//
// Each text element marked data-tier is rendered alone (all other text transparent) and
// compared with the picture without any text; the pixels that differ are its ink.
// 1. Cap height: the height of a capital H in the element's computed font (canvas
//    actualBoundingBoxAscent), as a share of the screen height.
// 2. Contrast: WCAG 2 ratio between the text colour and every background pixel inside the
//    ink box; the worst pixel counts.
// 3. Safe area: every ink box lies inside 5% of each edge.
// 4. No overlap between two ink boxes, and no text cut off by its container.
// 5. Zone: every zone-coloured element carries its number. The gel, the next row and the
//    time-in-zone list also carry the name; a score block shows its name if and only if the
//    whole name fits in the block, and never draws it cut.
// 6. Hue: any coloured (not grey) text, fill or border sits inside a zone (class z1..z7):
//    colour means the planned zone and nothing else (rule 7).
// 7. Reduced motion: with prefers-reduced-motion, no transition or animation lasts longer than 0.
// 8. Coverage: every piece of text on the page sits inside a data-tier element, so 1 to 4 see it.
// 9. Palette (once, from tokens.css): see palette.js.
// Not covered here (say so when this becomes the PL4 CI check): hue in box-shadow and gradients.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { SHOTS } = require('./shots');
const { checkPalette } = require('./palette');

// Minimums per tier (room-2d.md, "Measurable checks").
const TIERS = {
  hero: { cap: 0.2, contrast: 7 },
  gel: { cap: 0.25, contrast: 7 },
  value: { cap: 0.055, contrast: 7 },
  text: { cap: 0.03, contrast: 7 },
  minor: { cap: 0.03, contrast: 7 },
  label: { cap: 0.02, contrast: 4.5 },
};
const SAFE = 0.05;

function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function decode(probe, png) {
  const out = await probe.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  }, png.toString('base64'));
  return { ...out, at: (x, y) => { const i = (y * out.w + x) * 4; return [out.d[i], out.d[i + 1], out.d[i + 2]]; } };
}

async function collect(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const ctx = document.createElement('canvas').getContext('2d');
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const items = [];
    const els = [...document.querySelectorAll('[data-tier]')];
    els.forEach((el, i) => {
      el.dataset.mi = i;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) return;
      const box = {
        x0: Math.min(...rects.map((r) => r.left)), y0: Math.min(...rects.map((r) => r.top)),
        x1: Math.max(...rects.map((r) => r.right)), y1: Math.max(...rects.map((r) => r.bottom)),
      };
      // Text cut off by a container that hides overflow. Text placed wholly outside its
      // container (a score name that does not fit, moved to a hidden row) is not shown at all.
      let clipped = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if (ac.overflow !== 'visible' && a !== document.body && a !== document.documentElement) {
          const r = a.getBoundingClientRect();
          if (box.y0 >= r.bottom - 1 || box.x0 >= r.right - 1) return;
          if (box.x0 < r.left - 1 || box.x1 > r.right + 1 || box.y1 > r.bottom + 4) clipped = true;
          break;
        }
      }
      // A name clamped to N lines (data-clamp) may end in an ellipsis but never shows more.
      if (el.dataset.clamp) {
        const lh = parseFloat(cs.lineHeight);
        const h = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        if (h > lh * Number(el.dataset.clamp) + 1) clipped = true;
      }
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const colors = [el, ...el.querySelectorAll('*')].map((n) => rgb(getComputedStyle(n).color));
      items.push({
        i, tier: el.dataset.tier, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30),
        cap: ctx.measureText('H').actualBoundingBoxAscent / H, colors, box, clipped,
        anc: els.filter((o) => o !== el && (o.contains(el) || el.contains(o))).map((o) => els.indexOf(o)),
      });
    });
    // Zone elements: gel, next chip, score blocks, zone strip.
    const zones = [];
    for (const el of document.querySelectorAll('.gel:not(.blank), .next .chip, .list .chip, .block, .zones > div')) {
      const z = (el.className.match(/\bz([1-7])\b/) || [])[1];
      const r = el.getBoundingClientRect();
      if (el.classList.contains('block') && (!z || r.right > W)) {
        // Past blocks are grey with no zone (no z class): nothing to check but that.
        if (!z && el.classList.contains('gone')) continue;
      }
      if (!z) { zones.push({ z: '?', num: '', name: '', problem: 'zone element without a zone class' }); continue; }
      const num = el.matches('.chip') ? el.textContent : (el.querySelector('.n, .gel-num') || {}).textContent;
      const nameEl = el.matches('.chip') ? el.nextElementSibling : el.querySelector('.t, .gel-name');
      const name = nameEl ? nameEl.textContent.trim() : '';
      let problem = '';
      if (el.classList.contains('block')) {
        // Shown if and only if the whole name fits beside the number.
        const nr = nameEl ? nameEl.getBoundingClientRect() : null;
        const shown = !!nr && nr.top < r.bottom && nr.right <= Math.min(r.right, W) + 1;
        const cs = getComputedStyle(el);
        const n = el.querySelector('.n');
        const need = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (n ? n.offsetWidth : 0) + parseFloat(cs.columnGap) + (nameEl ? nameEl.offsetWidth : 0);
        const fits = need <= el.clientWidth + 1;
        if (shown !== fits) problem = shown ? 'name shown but does not fit' : 'name hidden although it fits';
        zones.push({ z, num: (num || '').trim(), name: shown ? name : '(number only: name does not fit)', problem });
      } else {
        if (!name) problem = 'name missing';
        else if (!el.matches('.chip') && nameEl.getBoundingClientRect().right > r.right + 1) problem = 'name cut off';
        zones.push({ z, num: (num || '').trim(), name, problem });
      }
    }
    // Hue outside a zone.
    const hues = [];
    const chroma = (s) => { const m = s.match(/[\d.]+/g); if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return 0; const [r, g, b] = m.slice(0, 3).map(Number); return Math.max(r, g, b) - Math.min(r, g, b); };
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('[class*="z"]') && el.closest('.z1, .z2, .z3, .z4, .z5, .z6, .z7')) continue;
      const c = getComputedStyle(el);
      const hasText = [...el.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim());
      const props = [['background', c.backgroundColor], ['border', c.borderRightColor]];
      if (hasText) props.push(['text', c.color]);
      for (const [p, v] of props) if (chroma(v) > 24 && !(p === 'border' && c.borderRightWidth === '0px')) hues.push(`${el.className || el.tagName} ${p} ${v}`);
    }
    // Coverage: text outside any data-tier element escapes checks 1 to 4.
    const loose = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent.trim() || t.parentElement.closest('[data-tier], style, script, title')) continue;
      loose.push(t.textContent.trim().slice(0, 30));
    }
    return { items, zones, hues, loose };
  });
}

// Two animation frames: a style change is painted before the next screenshot.
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const HIDE = '[data-tier], [data-tier] * { color: transparent !important; text-shadow: none !important; }';

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  const pal = checkPalette();
  console.log('palette (tokens.css)');
  console.table(pal.rows);
  failed += pal.failed;
  for (const s of SHOTS.filter((x) => x.room || x.presenter)) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(__dirname, s.file));
    await page.evaluate(() => document.fonts.ready);
    const { items, zones, hues, loose } = await collect(page);
    await page.addStyleTag({ content: HIDE });
    const probe = await browser.newPage();
    for (const it of items) {
      // The element's box, clipped to the screen, with a margin for ink outside its line box.
      const bx0 = Math.max(0, Math.floor(it.box.x0) - 8), by0 = Math.max(0, Math.floor(it.box.y0) - 8);
      const bx1 = Math.min(s.w, Math.ceil(it.box.x1) + 8), by1 = Math.min(s.h, Math.ceil(it.box.y1) + 8);
      if (bx1 <= bx0 || by1 <= by0) { it.ink = null; continue; }
      const clip = { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 };
      const bg = await decode(probe, await page.screenshot({ clip }));
      // Render this element's text alone, then diff with the background.
      await page.evaluate(({ i, colors }) => {
        const el = document.querySelector(`[data-mi="${i}"]`);
        [el, ...el.querySelectorAll('*')].forEach((n, k) => n.style.setProperty('color', `rgb(${colors[k].join(',')})`, 'important'));
      }, it);
      await settle(page);
      const one = await decode(probe, await page.screenshot({ clip }));
      await page.evaluate(({ i }) => {
        const el = document.querySelector(`[data-mi="${i}"]`);
        [el, ...el.querySelectorAll('*')].forEach((n) => n.style.removeProperty('color'));
      }, it);
      await settle(page); // the next screenshot must not show this text any more
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < clip.height; y += 1) {
        for (let x = 0; x < clip.width; x += 1) {
          const a = one.at(x, y), b = bg.at(x, y);
          // 90: the text's own pixels, not a repaint's anti-aliasing noise on rounded corners.
          if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 90) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
          }
        }
      }
      it.worst = Infinity;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          for (const c of it.colors) it.worst = Math.min(it.worst, ratio(c, bg.at(x, y)));
        }
      }
      it.ink = x1 < 0 ? null : { x0: x0 + bx0, y0: y0 + by0, x1: x1 + bx0, y1: y1 + by0 };
    }
    await probe.close();
    // The presenter window and the room preview are read at arm's length: no room-distance
    // cap heights, and the presenter window has no projector safe area.
    const preview = s.h < 600 || !s.room;
    const rows = [];
    for (const it of items) {
      const t = TIERS[it.tier];
      const problems = [];
      if (!it.ink) problems.push('no visible ink');
      else {
        if (!preview && it.cap < t.cap) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${t.cap * 100}%`);
        if (it.worst < t.contrast) problems.push(`contrast ${it.worst.toFixed(1)} < ${t.contrast}`);
        const k = it.ink;
        if (s.room && (k.x0 < s.w * SAFE - 0.5 || k.y0 < s.h * SAFE - 0.5 || k.x1 > s.w * (1 - SAFE) + 0.5 || k.y1 > s.h * (1 - SAFE) + 0.5)) problems.push('outside safe area');
        for (const o of items) {
          if (o === it || !o.ink || it.anc.includes(o.i)) continue;
          const b = o.ink;
          if (k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1) problems.push(`overlaps "${o.text}"`);
        }
      }
      if (it.clipped) problems.push('cut off');
      rows.push({ tier: it.tier, text: it.text, cap: (it.cap * 100).toFixed(2) + '%', contrast: it.ink ? it.worst.toFixed(1) : '-', result: problems.length ? 'FAIL ' + problems.join('; ') : 'ok' });
      if (problems.length) failed += 1;
    }
    for (const z of zones) {
      const problems = [];
      if (z.num !== z.z) problems.push(`number "${z.num}" is not ${z.z}`);
      if (z.problem) problems.push(z.problem);
      rows.push({ tier: 'zone', text: `zone ${z.z} ${z.name}`.slice(0, 30), cap: '', contrast: '', result: problems.length ? 'FAIL ' + problems.join('; ') : 'ok' });
      if (problems.length) failed += 1;
    }
    for (const t of loose) { rows.push({ tier: 'text', text: t, cap: '', contrast: '', result: 'FAIL text outside any data-tier element' }); failed += 1; }
    for (const h of hues) { rows.push({ tier: 'hue', text: h.slice(0, 30), cap: '', contrast: '', result: 'FAIL hue outside a zone' }); failed += 1; }
    // Reduced motion.
    const rm = await browser.newPage({ viewport: { width: s.w, height: s.h }, reducedMotion: 'reduce' });
    await rm.goto('file://' + path.join(__dirname, s.file));
    const moving = await rm.evaluate(() => [...document.querySelectorAll('*')].filter((el) => {
      const c = getComputedStyle(el);
      const long = (v) => v.split(',').some((d) => parseFloat(d) > 0);
      return long(c.transitionDuration) || (c.animationName !== 'none' && long(c.animationDuration));
    }).map((el) => el.className || el.tagName));
    await rm.close();
    rows.push({ tier: 'motion', text: 'reduced motion', cap: '', contrast: '', result: moving.length ? 'FAIL still moves: ' + moving.join(', ') : 'ok' });
    if (moving.length) failed += 1;
    console.log(`\n${s.png}${preview ? " (arm's length: room cap heights not checked)" : ''}`);
    console.table(rows);
    await page.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

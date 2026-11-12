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
// 5. Zone: every zone-coloured element carries its number, and its name where the spec asks.
// 6. Hue: any coloured (not grey) text, fill or border sits inside a zone (class z1..z7):
//    colour means the planned zone and nothing else (rule 7).
// 7. Reduced motion: with prefers-reduced-motion, no transition or animation lasts longer than 0.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { SHOTS } = require('./shots');

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
const ZONE_NAME_MIN_VH = 22; // a score block this wide or wider must show its zone name

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
  return page.evaluate(({ ZONE_NAME_MIN_VH }) => {
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
      // Text cut off by a container that hides overflow.
      let clipped = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if (ac.overflow !== 'visible' && a !== document.body && a !== document.documentElement) {
          const r = a.getBoundingClientRect();
          if (box.x0 < r.left - 1 || box.x1 > r.right + 1 || box.y1 > r.bottom + 4) clipped = true;
          break;
        }
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
    const vh = H / 100;
    for (const el of document.querySelectorAll('.gel:not(.blank), .next .chip, .list .chip, .block, .zones > div')) {
      const z = (el.className.match(/\bz([1-7])\b/) || [])[1];
      const r = el.getBoundingClientRect();
      if (el.classList.contains('block') && r.right <= W * 0.25 + 1) continue; // past: dimmed, not read
      const num = el.matches('.chip') ? el.textContent : (el.querySelector('.n, .gel-num') || {}).textContent;
      const nameEl = el.matches('.chip') ? el.nextElementSibling : el.querySelector('.t, .gel-name');
      const name = nameEl ? nameEl.textContent.trim() : '';
      const nameRequired = !el.classList.contains('block') || r.width >= ZONE_NAME_MIN_VH * vh;
      let nameVisible = !!name;
      if (nameEl && name) {
        const nr = nameEl.getBoundingClientRect();
        nameVisible = nr.right <= r.right + 1 || el.matches('.chip');
      }
      zones.push({ z, num: (num || '').trim(), name, nameRequired, nameVisible });
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
    return { items, zones, hues };
  }, { ZONE_NAME_MIN_VH });
}

const HIDE = '[data-tier], [data-tier] * { color: transparent !important; text-shadow: none !important; }';

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const s of SHOTS.filter((x) => x.room || x.presenter)) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(__dirname, s.file));
    await page.evaluate(() => document.fonts.ready);
    const { items, zones, hues } = await collect(page);
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
      const one = await decode(probe, await page.screenshot({ clip }));
      await page.evaluate(({ i }) => {
        const el = document.querySelector(`[data-mi="${i}"]`);
        [el, ...el.querySelectorAll('*')].forEach((n) => n.style.removeProperty('color'));
      }, it);
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < clip.height; y += 1) {
        for (let x = 0; x < clip.width; x += 1) {
          const a = one.at(x, y), b = bg.at(x, y);
          if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30) {
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
      if (z.nameRequired && !z.nameVisible) problems.push('name missing or cut off');
      rows.push({ tier: 'zone', text: `zone ${z.z} ${z.nameRequired ? z.name : '(narrow block: number only)'}`, cap: '', contrast: '', result: problems.length ? 'FAIL ' + problems.join('; ') : 'ok' });
      if (problems.length) failed += 1;
    }
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

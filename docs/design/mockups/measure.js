// The measurable checks of docs/design/room-2d.md, run on every mock-up at every size in
// shots.js, including the worst-case fixtures at every supported size and ratio:
//   node docs/design/mockups/measure.js        (ONLY=<regex> limits it to some shots)
// shoot.js runs it after the screenshots. Prints one table per shot, then a summary matrix
// (fixture by size), and exits 1 if any check fails.
//
// Each text element marked data-tier is rendered alone (all other text transparent) and
// compared with the picture without any text; the pixels that differ are its ink (ink.js).
// 1. Cap height: the height of a capital H in the element's computed font (canvas
//    actualBoundingBoxAscent), as a share of the screen height.
// 2. Contrast: WCAG 2 ratio between the text colour and every background pixel inside the
//    ink box; the worst pixel counts.
// 3. Safe area: every ink box lies inside 5% of each edge.
// 4. Collisions: no two ink boxes overlap; no text wraps to more lines than it may
//    (data-lines, default 1); no text is cut off by its own box or by any container, except an
//    ellipsis by design (data-clamp) and text shown only when it fits whole (data-fit).
// 5. Zone: every zone-coloured element carries its number. The gel, the next row and the
//    time-in-zone list also carry the name; a score block shows its name if and only if the
//    whole name fits in the block, and never draws it cut.
// 6. Hue: any coloured (not grey) text, fill or border sits inside a zone (class z1..z7).
// 7. Motion: with prefers-reduced-motion, no transition or animation lasts longer than 0; without
//    it, nothing that repeats (an infinite animation, the beat dot) cycles more than three
//    times a second. Screenshots are taken with animations stopped at their first frame.
// 8. Coverage: every piece of text on the page sits inside a data-tier element, so 1 to 4 see it.
// 9. Palette (once, from tokens.css): see palette.js.
// 10. Window screens (class-list.md): data-min-cap, a minimum cap height in pixels.
// Not covered here (say so when this becomes the PL4 CI check): hue in box-shadow and gradients.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { SHOTS } = require('./shots');
const { checkPalette } = require('./palette');
const collect = require('./collect');
const ink = require('./ink');
const { fit } = require('./fit');

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
// All text transparent. A text element's own outline (the FTP test tag) is hidden in both
// pictures too: Chromium anti-aliases a border at a fractional position differently after the
// text inside it is repainted, which would count the outline as ink.
const HIDE = '[data-tier], [data-tier] * { color: transparent !important; text-shadow: none !important; } [data-tier] { border-color: transparent !important; }';

// Two animation frames: a style change is painted before the next screenshot.
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// on: the element's own text colours; 'repaint': still transparent, but set inline so the
// background picture comes from the same repaint as the text picture (Chromium re-rasterises
// nearby anti-aliased edges, such as a plate's rounded corners, slightly differently after a
// repaint); false: back to the stylesheet.
function paint(page, it, on) {
  return page.evaluate(({ i, colors, on }) => {
    const el = document.querySelector(`[data-mi="${i}"]`);
    [el, ...el.querySelectorAll('*')].forEach((n, k) => {
      if (on === 'repaint') n.style.setProperty('color', 'rgba(0, 0, 0, 0)', 'important');
      else if (on) n.style.setProperty('color', `rgb(${colors[k].join(',')})`, 'important');
      else n.style.removeProperty('color');
    });
  }, { i: it.i, colors: it.colors, on });
}

async function inkOf(page, probe, s, it) {
  // The element's box, clipped to the screen, with a margin for ink outside its line box.
  const bx0 = Math.max(0, Math.floor(it.box.x0) - 8), by0 = Math.max(0, Math.floor(it.box.y0) - 8);
  const bx1 = Math.min(s.w, Math.ceil(it.box.x1) + 8), by1 = Math.min(s.h, Math.ceil(it.box.y1) + 8);
  if (bx1 <= bx0 || by1 <= by0) return null;
  const clip = { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 };
  await paint(page, it, 'repaint');
  await settle(page);
  const bg = await page.screenshot({ clip, animations: 'disabled' });
  await paint(page, it, true);
  await settle(page);
  const one = await page.screenshot({ clip, animations: 'disabled' });
  await paint(page, it, false);
  await settle(page); // the next screenshot must not show this text any more
  const r = await probe.evaluate(ink, [bg.toString('base64'), one.toString('base64'), it.colors, ink.INK]);
  if (!r) return null;
  return { worst: r.worst, box: { x0: r.box.x0 + bx0, y0: r.box.y0 + by0, x1: r.box.x1 + bx0, y1: r.box.y1 + by0 } };
}

async function check(browser, probe, s) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: s.motion || 'no-preference' });
  await page.goto('file://' + path.join(__dirname, s.file));
  await page.evaluate(() => document.fonts.ready);
  const { items, zones, hues, loose } = await page.evaluate(collect);
  await page.addStyleTag({ content: HIDE });
  for (const it of items) {
    const r = await inkOf(page, probe, s, it);
    it.ink = r && r.box;
    it.worst = r ? r.worst : Infinity;
  }
  // The presenter window and the room preview are read at arm's length: no room-distance
  // cap heights, and the presenter window has no projector safe area.
  const preview = s.h < 600 || !s.room;
  const rows = [];
  for (const it of items) {
    const t = TIERS[it.tier];
    const problems = [...it.problems];
    if (!it.ink) problems.push('no visible ink');
    else {
      if (!preview && it.cap < t.cap) problems.push(`cap ${(it.cap * 100).toFixed(2)}% < ${t.cap * 100}%`);
      // A window screen (class-list.md) states its minimum in pixels: data-min-cap.
      if (it.minpx && it.cap * s.h < it.minpx - 0.05) problems.push(`cap ${(it.cap * s.h).toFixed(1)} px < ${it.minpx} px`);
      if (it.worst < t.contrast) problems.push(`contrast ${it.worst.toFixed(1)} < ${t.contrast}`);
      const k = it.ink;
      if (s.room && (k.x0 < s.w * SAFE - 0.5 || k.y0 < s.h * SAFE - 0.5 || k.x1 > s.w * (1 - SAFE) + 0.5 || k.y1 > s.h * (1 - SAFE) + 0.5)) problems.push('outside safe area');
      for (const o of items) {
        if (o === it || !o.ink || it.anc.includes(o.i)) continue;
        const b = o.ink;
        if (k.x0 < b.x1 && b.x0 < k.x1 && k.y0 < b.y1 && b.y0 < k.y1) problems.push(`overlaps "${o.text}"`);
      }
    }
    rows.push({ tier: it.tier, text: it.text, lines: it.lines, cap: (it.cap * 100).toFixed(2) + '%', contrast: it.ink ? it.worst.toFixed(1) : '-', result: problems.length ? 'FAIL ' + problems.join('; ') : 'ok' });
  }
  for (const z of zones) {
    const problems = [];
    if (z.z !== '-' && z.num !== z.z) problems.push(`number "${z.num}" is not ${z.z}`);
    if (z.problem) problems.push(z.problem);
    rows.push({ tier: 'zone', text: `zone ${z.z} ${z.name}`.slice(0, 30), lines: '', cap: '', contrast: '', result: problems.length ? 'FAIL ' + problems.join('; ') : 'ok' });
  }
  for (const t of loose) rows.push({ tier: 'text', text: t, lines: '', cap: '', contrast: '', result: 'FAIL text outside any data-tier element' });
  for (const h of hues) rows.push({ tier: 'hue', text: h.slice(0, 30), lines: '', cap: '', contrast: '', result: 'FAIL hue outside a zone' });
  // Website pages (site.md): touch targets, no sideways scroll, one h1 and one main.
  if (s.site) {
    const found = await page.evaluate(() => {
      const low = [...document.querySelectorAll('.btn, .input, .nav .a, .nav .navbtn, .subnav .a, .row .t .a, .back')]
        .filter((el) => el.getBoundingClientRect().height < 43.5).map((el) => (el.textContent.trim() || el.className).slice(0, 24));
      const wide = document.documentElement.scrollWidth > innerWidth;
      return [
        ['controls at least 44 px high', low.length ? 'FAIL too low: ' + low.join(', ') : 'ok'],
        ['no sideways scroll', wide ? `FAIL scrollWidth ${document.documentElement.scrollWidth} > ${innerWidth}` : 'ok'],
        ['one h1 in one main', document.querySelectorAll('h1').length === 1 && document.querySelectorAll('main').length === 1 ? 'ok' : 'FAIL'],
      ];
    });
    for (const [text, result] of found) rows.push({ tier: 'site', text, lines: '', cap: '', contrast: '', result });
  }
  // Reduced motion.
  const rm = await browser.newPage({ viewport: { width: s.w, height: s.h }, reducedMotion: 'reduce' });
  await rm.goto('file://' + path.join(__dirname, s.file));
  const moving = await rm.evaluate(() => [...document.querySelectorAll('*')].filter((el) => {
    const c = getComputedStyle(el);
    const long = (v) => v.split(',').some((d) => parseFloat(d) > 0);
    return long(c.transitionDuration) || (c.animationName !== 'none' && long(c.animationDuration));
  }).map((el) => el.className || el.tagName));
  await rm.close();
  // Flash rate: a repeating animation cycles at most three times a second.
  const fast = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => {
    const c = getComputedStyle(el);
    if (c.animationName === 'none' || !c.animationIterationCount.includes('infinite')) return false;
    return c.animationDuration.split(',').some((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 0.001 : 1) < 1 / 3);
  }).map((el) => el.className || el.tagName));
  rows.push({ tier: 'motion', text: 'at most 3 flashes a second', lines: '', cap: '', contrast: '', result: fast.length ? 'FAIL repeats faster: ' + fast.join(', ') : 'ok' });
  rows.push({ tier: 'motion', text: 'reduced motion', lines: '', cap: '', contrast: '', result: moving.length ? 'FAIL still moves: ' + moving.join(', ') : 'ok' });
  await page.close();
  // The smallest margins, for the summary.
  const room = items.filter((it) => it.ink);
  const minCap = (tier) => Math.min(...room.filter((it) => it.tier === tier).map((it) => it.cap));
  return { rows, preview, failed: rows.filter((r) => r.result !== 'ok').length, heroCap: minCap('hero'), valueCap: minCap('value') };
}

async function measure(shots) {
  const browser = await chromium.launch();
  const probe = await browser.newPage();
  const pal = checkPalette();
  console.log('palette (tokens.css)');
  console.table(pal.rows);
  let failed = pal.failed;
  const results = [];
  for (const s of shots.filter((x) => x.room || x.presenter)) {
    await fit(browser, s);
    const r = await check(browser, probe, s);
    console.log(`\n${s.png}${r.preview ? " (arm's length: room cap heights not checked)" : ''}`);
    console.table(r.rows);
    failed += r.failed;
    results.push({ s, r });
  }
  await browser.close();
  console.log('\n' + summary(results));
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  return failed;
}

// Fixture by size: "ok" or the number of failed checks; for the countdown and the values the
// smallest cap height measured (Markdown, for the pull request).
function summary(results) {
  const files = [...new Set(results.map(({ s }) => s.file.replace(/\.html$/, '')))];
  const sizes = [...new Set(results.map(({ s }) => `${s.w}×${s.h}`))];
  const head = `| Fixture | ${sizes.join(' | ')} |\n|---|${sizes.map(() => '---').join('|')}|`;
  const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) : '-');
  const lines = files.map((f) => `| ${f} | ${sizes.map((z) => {
    const hit = results.find(({ s }) => s.file === f + '.html' && `${s.w}×${s.h}` === z);
    if (!hit) return '';
    const caps = hit.r.preview ? '' : ` ${pct(hit.r.heroCap)}/${pct(hit.r.valueCap)}`;
    return (hit.r.failed ? `**${hit.r.failed} FAIL**` : 'ok') + caps;
  }).join(' | ')} |`);
  return `Summary (each cell: result, then the smallest cap height of the countdown / of a value, % of the screen height)\n\n${head}\n${lines.join('\n')}`;
}

module.exports = { measure };

if (require.main === module) {
  measure(SHOTS).then((failed) => process.exit(failed ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
}

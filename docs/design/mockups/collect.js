// What measure.js reads from a rendered mock-up: runs inside the page (page.evaluate).
// Returns the data-tier text elements with their layout problems (lines, cut off), the zone
// elements (C5), hue outside a zone (C6) and text no check sees (C8).
//
// Markup the checks rely on:
//   data-tier="hero|gel|value|text|minor|label"  the type tier (C1, C2)
//   data-lines="N"   the element may take up to N lines (default 1: any wrap fails)
//   data-clamp="N"   the element ends in an ellipsis after N lines by design (not "cut off")
//   data-min-cap="N"  a window screen (class-list.md): the cap height must be at least N px
//   data-scroll      a scrolling region (class-list.md): text scrolled out of it is not checked
//   data-fit="hide"  the element is shown only if it fits whole (wraps onto a hidden row
//                    otherwise); checked both ways: shown if and only if it fits
'use strict';

module.exports = function collect() {
  const W = innerWidth;
  const ctx = document.createElement('canvas').getContext('2d');
  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const clips = (cs) => cs.overflow !== 'visible';
  const rectOf = (r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  const items = [];
  const els = [...document.querySelectorAll('[data-tier]')];

  // The rendered line fragments of an element's own text (not of nested data-tier elements).
  function ownRects(el) {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent.trim() || t.parentElement.closest('[data-tier]') !== el) continue;
      const r = document.createRange();
      r.selectNodeContents(t);
      out.push(...[...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0));
    }
    return out;
  }

  // Shown if and only if it fits: items are laid out in order; the first that does not fit
  // and every one after it wrap onto the hidden row.
  function fitProblems(container) {
    const cs = getComputedStyle(container);
    const room = container.clientWidth - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 0;
    let x = parseFloat(cs.paddingLeft), fitting = true;
    const cr = container.getBoundingClientRect();
    const out = [];
    [...container.children].forEach((c, k) => {
      const m = getComputedStyle(c);
      x += (k ? gap : 0) + c.getBoundingClientRect().width + parseFloat(m.marginLeft) + parseFloat(m.marginRight);
      if (x > room + 1) fitting = false;
      if (c.dataset.fit !== 'hide') return;
      const r = c.getBoundingClientRect();
      const shown = r.top < cr.bottom && r.bottom > cr.top;
      if (shown && !fitting) out.push([c, 'shown but does not fit whole']);
      if (!shown && fitting) out.push([c, 'hidden although it fits']);
    });
    return out;
  }
  const fitIssues = new Map();
  for (const c of new Set([...document.querySelectorAll('[data-fit]')].map((e) => e.parentElement))) {
    for (const [el, p] of fitProblems(c)) fitIssues.set(el, p);
  }

  els.forEach((el, i) => {
    el.dataset.mi = i;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const range = document.createRange();
    range.selectNodeContents(el);
    let rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) return;
    const ownBox = el.getBoundingClientRect();
    const selfClips = clips(cs);
    // What can be seen of the text: an element that clips its own overflow shows only its box.
    let box = {
      x0: Math.min(...rects.map((r) => r.left)), y0: Math.min(...rects.map((r) => r.top)),
      x1: Math.max(...rects.map((r) => r.right)), y1: Math.max(...rects.map((r) => r.bottom)),
    };
    if (selfClips) box = rectOf(ownBox);
    const problems = [];
    if (fitIssues.has(el)) problems.push(fitIssues.get(el));
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    // Lines: the element's own text fragments, grouped by their vertical centre.
    const countLines = (rs) => {
      const c = rs.map((r) => (r.top + r.bottom) / 2).sort((p, q) => p - q);
      let n = c.length ? 1 : 0;
      for (let k = 1; k < c.length; k += 1) if (c[k] - c[k - 1] > lh * 0.5) n += 1;
      return n;
    };
    const all = ownRects(el);
    const laidOut = countLines(all);
    // Cut off by the element itself (unless it ends in an ellipsis by design). A glyph may
    // overhang its line box by a few pixels; a hidden line or word is far more.
    if (selfClips && !el.dataset.clamp && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + lh * 0.5)) problems.push('cut off by its own box');
    // A clamped element shows whole lines only: at most data-clamp, and all of them whole.
    if (el.dataset.clamp) {
      // The layout's own clamp when the CSS sets one (it may differ per layout).
      const n = Number(cs.webkitLineClamp) || Number(el.dataset.clamp);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (h > lh * n + 1) problems.push(`shows more than ${n} line(s)`);
      // A word wider than a multi-line box is cut at the side, with no ellipsis.
      if (n > 1 && el.scrollWidth > el.clientWidth + 2) problems.push('a word is cut at the side');
      if (h < lh * Math.min(n, laidOut) - 1) problems.push(`a line is cut (${(h / lh).toFixed(2)} of ${Math.min(n, laidOut)} lines shown)`);
    }
    // Cut off by any container that hides overflow. An element shown only if it fits
    // (data-fit) may lie wholly outside: it is not shown at all, by design.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (!clips(getComputedStyle(a))) continue;
      const r = a.getBoundingClientRect();
      // A scrolling region (data-scroll) legitimately hides what is scrolled out of it, wholly or
      // in part: such text is not checked in this state (the same rows are checked where they show).
      if (a.hasAttribute('data-scroll')) {
        if (box.y0 < r.top - 4 || box.y1 > r.bottom + 4) return;
        continue;
      }
      const outside = box.y0 >= r.bottom - 1 || box.x0 >= r.right - 1 || box.y1 <= r.top + 1 || box.x1 <= r.left + 1;
      if (outside) {
        if (el.dataset.fit === 'hide') return;
        problems.push('hidden by its container');
        break;
      }
      if (box.x0 < r.left - 1 || box.x1 > r.right + 1 || box.y1 > r.bottom + 4 || box.y0 < r.top - 4) { problems.push('cut off by its container'); break; }
    }
    // Lines shown (an element that clips shows only the lines inside its box).
    const inside = (r) => (r.top + r.bottom) / 2 < ownBox.bottom && (r.top + r.bottom) / 2 > ownBox.top;
    // Covered: a fill drawn over the text (the score over a list that runs too long). Probed
    // at five points in the middle band of every line fragment that is shown; only an element
    // that paints a background counts (text boxes overlap harmlessly where their ink does not).
    const covered = new Set();
    const fills = (n) => {
      const c = getComputedStyle(n);
      const a = c.backgroundColor.match(/[\d.]+/g);
      return c.backgroundImage !== 'none' || (a && (a[3] === undefined || Number(a[3]) > 0.1));
    };
    for (const r of all.filter((q) => !selfClips || inside(q))) {
      const pts = [[0.5, 0.5], [0.15, 0.4], [0.85, 0.4], [0.15, 0.6], [0.85, 0.6]];
      for (const [fx, fy] of pts) {
        // An element that clips (an ellipsis) shows only the part of the line inside its box.
        const l = selfClips ? Math.max(r.left, ownBox.left) : r.left, rr = selfClips ? Math.min(r.right, ownBox.right) : r.right;
        const x = l + (rr - l) * fx, y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        for (let n = document.elementFromPoint(x, y); n && n !== document.body; n = n.parentElement) {
          if (n === el || n.contains(el) || el.contains(n)) break;
          if (fills(n)) { covered.add((n.className || n.tagName).toString().slice(0, 20)); break; }
        }
      }
    }
    if (covered.size) problems.push(`covered by ${[...covered].join(', ')}`);
    const lines = selfClips ? countLines(all.filter(inside)) : laidOut;
    const maxLines = Number(el.dataset.lines || 1);
    if (lines > maxLines) problems.push(`wraps to ${lines} lines (at most ${maxLines})`);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const colors = [el, ...el.querySelectorAll('*')].map((n) => rgb(getComputedStyle(n).color));
    items.push({
      // A fitting step-down may move an element to a lower tier in some layouts (--tier).
      i, tier: cs.getPropertyValue('--tier').trim() || el.dataset.tier, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30),
      cap: ctx.measureText("H").actualBoundingBoxAscent / innerHeight, minpx: Number(el.dataset.minCap) || 0, colors, box, problems, lines,
      anc: els.filter((o) => o !== el && (o.contains(el) || el.contains(o))).map((o) => els.indexOf(o)),
    });
  });

  // Zone elements: gel, next chip, score blocks, time-in-zone rows.
  const zones = [];
  for (const el of document.querySelectorAll('.gel:not(.blank), .next .chip, .list .chip, .block, .zones > div')) {
    const z = (el.className.match(/\bz([1-7])\b/) || [])[1];
    // Past blocks are grey with no zone (no z class) and no number: nothing to check but that.
    if (!z && el.classList.contains('block') && el.classList.contains('gone')) {
      if (el.textContent.trim()) zones.push({ z: '-', num: el.textContent.trim(), name: '', problem: 'a past block carries text' });
      continue;
    }
    if (!z) { zones.push({ z: '?', num: '', name: '', problem: 'zone element without a zone class' }); continue; }
    const r = el.getBoundingClientRect();
    // A block wholly past the right safe edge carries nothing: it is not on screen as information.
    if (el.classList.contains('block') && r.left >= W * 0.95) continue;
    const num = el.matches('.chip') ? el.textContent : (el.querySelector('.n, .gel-num') || {}).textContent;
    const nameEl = el.matches('.chip') ? el.nextElementSibling : el.querySelector('.t, .gel-name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    let problem = '';
    if (el.classList.contains('block')) {
      // The name is shown if and only if it fits whole (checked with the data-fit rule above).
      const nr = nameEl ? nameEl.getBoundingClientRect() : null;
      const shown = !!nr && nr.top < r.bottom;
      zones.push({ z, num: (num || '').trim(), name: shown ? name : '(number only: name does not fit)', problem });
    } else {
      if (!name) problem = 'name missing';
      else if (!el.matches('.chip') && nameEl.getBoundingClientRect().right > r.right + 1) problem = 'name cut off';
      zones.push({ z, num: (num || '').trim(), name, problem });
    }
  }

  // Hue outside a zone (rule 7).
  const hues = [];
  const chroma = (s) => { const m = s.match(/[\d.]+/g); if (!m || (m[3] !== undefined && Number(m[3]) === 0)) return 0; const [r, g, b] = m.slice(0, 3).map(Number); return Math.max(r, g, b) - Math.min(r, g, b); };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.z1, .z2, .z3, .z4, .z5, .z6, .z7')) continue;
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
};

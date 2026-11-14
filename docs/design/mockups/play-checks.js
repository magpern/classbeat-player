// The web player page's own checks (docs/design/play.md, "Measurable checks"), used by
// measure.js for every /play room shot. A tablet in landscape (at least 720 lines) is the room
// screen and keeps the room's floors (room-2d.md, C1); a phone or a portrait screen keeps the
// handlebar companion's floors (companion.md, K1), per orientation, with their pixel floors and
// 7 : 1 for all text.
'use strict';
const companion = require('./companion-checks');

// The size class of a shot (play.md, "Sizes").
const sizeClass = (s) => (s.w > s.h ? (s.h >= 720 ? 'room' : 'small-landscape') : 'portrait');

// The tier table measure.js applies to one shot. room: the room's table, passed in, with a
// textmin row equal to text (the room has none: a long cue is checked at the text floor).
function tiersFor(s, roomTiers) {
  if (sizeClass(s) === 'room') return { ...roomTiers, textmin: roomTiers.text };
  return companion.tiersFor(s);
}

// Runs inside the page (page.evaluate). Returns [check, result] rows.
function pageChecks() {
  const KEY_MIN = 64, KEY_GAP = 12;
  // Every control the page has (ADR 0008 section 3): the band and the End question. Nothing
  // that follows the music, hands the clock over or undoes: the page has only the manual clock.
  const ACTIONS = ['start', 'pause', 'resume', 'previous', 'next', 'end', 'end-class', 'keep-going', 'close'];
  const BANNED = /undo|follow|manual|music|sync/i;
  const rows = [];
  const shown = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const targets = [...document.querySelectorAll('[data-action]')].filter(shown);
  const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < KEY_MIN - 0.5 || r.width < KEY_MIN - 0.5; });
  rows.push([`touch targets at least ${KEY_MIN} x ${KEY_MIN} px`, small.length ? 'FAIL ' + small.map((e) => `${e.textContent.trim().slice(0, 16)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`).join(', ') : 'ok']);
  const close = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i].getBoundingClientRect(), b = targets[j].getBoundingClientRect();
      const sep = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
      if (sep < KEY_GAP - 0.5) close.push(`${targets[i].textContent.trim().slice(0, 12)} / ${targets[j].textContent.trim().slice(0, 12)} ${sep.toFixed(1)}`);
    }
  }
  rows.push([`at least ${KEY_GAP} px between targets`, close.length ? 'FAIL ' + close.join(', ') : 'ok']);
  const all = [...document.querySelectorAll('[data-action]')];
  const bad = all.filter((k) => !ACTIONS.includes(k.dataset.action) || BANNED.test(k.textContent)).map((k) => k.dataset.action);
  rows.push(['only the page\'s controls: no Undo, Follow or Manual', bad.length ? 'FAIL ' + bad.join(', ') : 'ok']);
  const offscreen = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5; });
  rows.push(['every control on the screen', offscreen.length ? 'FAIL ' + offscreen.map((e) => e.dataset.action).join(', ') : 'ok']);
  const de = document.documentElement;
  rows.push(['one screen, no scroll', de.scrollHeight > innerHeight + 0.5 || de.scrollWidth > innerWidth + 0.5 ? `FAIL ${de.scrollWidth}x${de.scrollHeight}` : 'ok']);
  // What must be visible at once (play.md, "Visible at once"): while the class runs, the zone
  // (number and name), the countdown, the cue, the next row and the score or the band; before
  // the start and at the end, the gel, the title, the facts and the band.
  const inView = (q) => { const el = document.querySelector(q); if (!el || !shown(el)) return false; const r = el.getBoundingClientRect(); return r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5; };
  const need = document.querySelector('.count')
    ? ['.gel .gel-num', '.gel .gel-name', '.rail .link', '.count', '.metrics', '.cue', '.next', document.body.classList.contains('shown') ? '.controls' : '.score']
    : ['.gel .gel-name', '.rail .link', '.intro h1', '.facts', '.zones', '.controls'];
  const missing = need.filter((q) => !inView(q));
  rows.push(['visible at once', missing.length ? 'FAIL missing ' + missing.join(', ') : 'ok']);
  return rows;
}

// Safe area: the room's 5 % on a tablet in landscape; elsewhere text keeps 8 px from each edge.
function safeArea(s) {
  if (sizeClass(s) === 'room') return { x: s.w * 0.05, y: s.h * 0.05 };
  return { x: 8, y: 8 };
}

module.exports = { sizeClass, tiersFor, pageChecks, safeArea };

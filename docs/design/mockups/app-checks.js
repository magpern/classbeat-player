// The Android app's own checks (docs/design/app.md, "Measurable checks"), used by measure.js for
// every app shot. The app's pages keep the companion's floors per orientation (companion.md, K1);
// its class screen keeps /play's (the room's on a tablet in landscape, play-checks.js); the
// external display keeps the room's (room-2d.md, C1) with the room's 5 % safe area.
'use strict';
const companion = require('./companion-checks');
const play = require('./play-checks');

// The tier table measure.js applies to one shot. roomTiers: the room's table.
function tiersFor(s, roomTiers) {
  if (s.display) return roomTiers;
  if (s.appRoom) return play.tiersFor(s, roomTiers);
  return companion.tiersFor(s);
}

function safeArea(s) {
  if (s.display) return { x: s.w * 0.05, y: s.h * 0.05 };
  if (s.appRoom) return play.safeArea(s);
  return { x: 8, y: 8 };
}

// Runs inside the page (page.evaluate). arg.form: the state may scroll vertically (the keyboard
// is up). Returns [check, result] rows.
function pageChecks(arg) {
  const KEY_MIN = 64, KEY_GAP = 12;
  // Every action the app's screens have. None sends an equipment command (rule 2); the rider's
  // send nothing but the join (ADR 0007 section 1). Nothing scans or opens the camera (rule 12).
  const ACTIONS = ['switch_mode', 'stay', 'set_lock', 'stay_rider', 'open_class', 'cancel', 'open_site', 'continue', 'pair_again',
    'open_setting', 'not_now', 'follow', 'join', 'remember', 'leave', 'keep_riding', 'start', 'pause', 'resume', 'previous', 'next', 'end'];
  const BANNED = /scan|camera|qr/i;
  const rows = [];
  const shown = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const targets = [...document.querySelectorAll('[data-action], .input')].filter(shown);
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
  rows.push(['only the app\'s own actions: no command, no camera', bad.length ? 'FAIL ' + bad.join(', ') : 'ok']);
  const de = document.documentElement;
  const side = de.scrollWidth > innerWidth + 0.5;
  const tall = de.scrollHeight > innerHeight + 0.5;
  rows.push([arg.form ? 'no sideways scroll (a form may scroll down)' : 'one screen, no scroll', side || (tall && !arg.form) ? `FAIL ${de.scrollWidth}x${de.scrollHeight}` : 'ok']);
  if (!arg.form) {
    const off = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5; });
    rows.push(['every control on the screen', off.length ? 'FAIL ' + off.map((e) => e.dataset.action || 'input').join(', ') : 'ok']);
  }
  // The mode strip is on a start page only: never during a class, never while joined.
  const strip = document.querySelector('.strip');
  rows.push(['no mode switch during a class', strip && document.querySelector('.count, .run') ? 'FAIL strip shown with the class' : 'ok']);
  // A9: the mode tag, where a page has one, names the mode in words and nothing else.
  const tag = [...document.querySelectorAll('.mode')];
  const wrong = tag.filter((t) => !/^(Rider|Instructor) mode$/.test(t.textContent.trim()));
  rows.push(['mode tag reads "Rider mode" or "Instructor mode"', wrong.length ? 'FAIL ' + wrong.map((t) => t.textContent.trim()).join(', ') : 'ok']);
  // The class screen: what must be visible at once (play.md), with "Follow the music" in the band.
  if (document.body.classList.contains('app-room') && !document.querySelector('.idle')) {
    const inView = (q) => { const el = document.querySelector(q); if (!el || !shown(el)) return false; const r = el.getBoundingClientRect(); return r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5; };
    const need = document.querySelector('.count')
      ? ['.gel .gel-num', '.gel .gel-name', '.rail .link', '.count', '.metrics', '.cue', '.next', document.body.classList.contains('shown') ? '.controls' : '.score']
      : ['.gel .gel-name', '.rail .link', '.intro h1', '.facts', '.zones', '.controls'];
    if (document.querySelector('[data-action=follow]')) need.push('[data-action=follow]');
    const missing = need.filter((q) => !inView(q));
    rows.push(['visible at once', missing.length ? 'FAIL missing ' + missing.join(', ') : 'ok']);
  }
  // Rules 13 and 15: nothing on any screen draws another rider, a count, a list of riders or a team.
  const forbidden = document.querySelectorAll('canvas, [class*=ring], [class*=rank], [class*=riders], [class*=leader], [class*=team]');
  rows.push(['no other rider, ranking or team', forbidden.length ? 'FAIL ' + [...forbidden].map((e) => e.className || e.tagName).join(', ') : 'ok']);
  return rows;
}

module.exports = { tiersFor, safeArea, pageChecks };

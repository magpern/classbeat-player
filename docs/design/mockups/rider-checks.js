// The rider page's own checks (docs/design/rider.md, "Measurable checks"), used by measure.js for
// every rider shot. Text heights and contrast are the companion's (companion-checks.js); these are
// the page's: touch targets, what it may send, one screen, what must be visible at once.
'use strict';

// Runs inside the page (page.evaluate). arg.form: the state may scroll vertically (the keyboard
// is up). Returns [check, result] rows.
function pageChecks(arg) {
  const KEY_MIN = 64, KEY_GAP = 12;
  // The rider sends nothing after joining but hello (ADR 0007 section 1); these are the page's own
  // actions, none of which sends a command, and none touches equipment (rule 2).
  const ACTIONS = ['join', 'forget', 'remember', 'my_numbers', 'done', 'retry'];
  const rows = [];
  const shown = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const targets = [...document.querySelectorAll('.key, .input')].filter(shown);
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
  const keys = [...document.querySelectorAll('[data-action]')];
  const bad = keys.filter((k) => !ACTIONS.includes(k.dataset.action)).map((k) => k.dataset.action);
  rows.push(['only the page\'s own actions, no command', bad.length ? 'FAIL ' + bad.join(', ') : 'ok']);
  const de = document.documentElement;
  const side = de.scrollWidth > innerWidth + 0.5;
  const tall = de.scrollHeight > innerHeight + 0.5;
  rows.push([arg.form ? 'no sideways scroll (a form may scroll down)' : 'one screen, no scroll', side || (tall && !arg.form) ? `FAIL ${de.scrollWidth}x${de.scrollHeight}` : 'ok']);
  // What must be visible at once in the class view (rider.md, "Content").
  const run = document.querySelector('.run');
  if (run && document.querySelector('.count')) {
    const need = ['.gel .gel-num', '.gel .gel-name', '.count', '.effort', '.next', '[data-action=my_numbers]'];
    const missing = need.filter((q) => { const el = document.querySelector(q); return !el || !shown(el) || el.getBoundingClientRect().bottom > innerHeight; });
    rows.push(['visible at once', missing.length ? 'FAIL missing ' + missing.join(', ') : 'ok']);
  }
  // Rules 6 and 13: nothing on the page draws a rider, a count or a list of riders.
  const forbidden = document.querySelectorAll('canvas, svg, [class*=ring], [class*=rank], [class*=riders], [class*=leader]');
  rows.push(['no ring, bar, count or list of riders', forbidden.length ? 'FAIL ' + [...forbidden].map((e) => e.className || e.tagName).join(', ') : 'ok']);
  return rows;
}

module.exports = { pageChecks };

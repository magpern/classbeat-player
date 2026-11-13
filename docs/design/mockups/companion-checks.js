// The handlebar companion's own checks (docs/design/companion.md, "Measurable checks"), used by
// measure.js for every companion shot. Text heights are shares of the viewport height, one floor
// for portrait and one for landscape, and a floor in CSS pixels for both.
'use strict';

// Cap height floors: [portrait share, landscape share, CSS px]. Contrast: 7 : 1 for all text.
const FLOORS = {
  gel: [0.085, 0.155, 54],
  hero: [0.08, 0.135, 48],
  value: [0.034, 0.06, 21],
  text: [0.026, 0.045, 16.5],
  textmin: [0.021, 0.037, 13.5],
  minor: [0.019, 0.034, 12.5],
  label: [0.015, 0.027, 10],
};
const CONTRAST = 7;

// The tier table measure.js applies to one shot.
function tiersFor(s) {
  const land = s.w > s.h;
  const out = {};
  for (const [t, [p, l, px]] of Object.entries(FLOORS)) out[t] = { cap: land ? l : p, px, contrast: CONTRAST };
  return out;
}

// Runs inside the page (page.evaluate). Returns [check, result] rows.
function pageChecks() {
  const KEY_MIN = 64, KEY_GAP = 12;
  // The contract's command actions (schema/live/v1/command.schema.json), exactly, and the page's
  // own actions that send no command. Nothing here controls equipment (rule 2).
  const COMMANDS = ['start', 'pause', 'resume', 'skip', 'nudge', 'undo_resync'];
  const ACTIONS = COMMANDS.concat(['sign_in', 'control', 'cancel', 'reconnect', 'get_control']);
  // Presses that move the class on are held to confirm; stopping, the nudges and the undo are one touch.
  const HOLD = ['start', 'resume', 'skip'];
  const ONE_TOUCH = ['pause', 'nudge', 'undo_resync'];
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
  rows.push(['only allowed actions (rule 2)', bad.length ? 'FAIL ' + bad.join(', ') : 'ok']);
  const delta = keys.filter((k) => (k.dataset.action === 'nudge') !== ['5000', '-5000'].includes(k.dataset.delta || ''));
  rows.push(['nudge is exactly +5000 or -5000 ms', delta.length ? 'FAIL ' + delta.map((k) => k.textContent.trim()).join(', ') : 'ok']);
  const guard = keys.filter((k) => (HOLD.includes(k.dataset.action) && k.dataset.guard !== 'hold') || (ONE_TOUCH.includes(k.dataset.action) && k.dataset.guard));
  rows.push(['hold-to-confirm on class-moving keys only', guard.length ? 'FAIL ' + guard.map((k) => k.dataset.action).join(', ') : 'ok']);
  const de = document.documentElement;
  rows.push(['one screen, no scroll', de.scrollHeight > innerHeight + 0.5 || de.scrollWidth > innerWidth + 0.5 ? `FAIL ${de.scrollWidth}x${de.scrollHeight}` : 'ok']);
  // What must be visible at once while the class runs (companion.md, "Content").
  const run = document.querySelector('.run');
  if (run && document.querySelector('.count')) {
    const need = ['.gel .gel-num', '.gel .gel-name', '.count', '.song', '.cue'];
    if (!run.classList.contains('tighter')) need.push('.next');
    if (!document.querySelector('.keys .msg') && !document.querySelector('[data-action=start]')) need.push('[data-action=pause], [data-action=resume]');
    const missing = need.filter((q) => { const el = document.querySelector(q); return !el || !shown(el) || el.getBoundingClientRect().bottom > innerHeight; });
    rows.push(['visible at once', missing.length ? 'FAIL missing ' + missing.join(', ') : 'ok']);
  }
  return rows;
}

module.exports = { FLOORS, tiersFor, pageChecks };

// The web player page's own checks on the rendered page (docs/design/play.md, "Measurable checks"),
// ported from docs/design/mockups/play-checks.js: P4 touch targets, P5 controls, P6 one screen and what
// must be visible at once, and the fonts of P10. Runs inside the page (page.evaluate), so it is
// self-contained: no imports, no outer references. Returns [check, result] rows.

export default function pageChecks() {
  const KEY_MIN = 64, KEY_GAP = 12;
  // Every control the page has: the band and the End question. Nothing that follows the music,
  // hands the clock over or undoes: the page has only the manual clock.
  const ACTIONS = ['start', 'pause', 'resume', 'previous', 'next', 'end', 'end-class', 'keep-going', 'close'];
  const BANNED = /undo|follow|manual|music|sync/i;
  const FACES = ['"Big Shoulders Display"', '"Atkinson Hyperlegible"'];
  const rows = [];
  const shown = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const label = (e) => e.textContent.trim().slice(0, 16);
  const targets = [...document.querySelectorAll('[data-action]')].filter(shown);
  const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < KEY_MIN - 0.5 || r.width < KEY_MIN - 0.5; });
  rows.push([`P4 touch targets at least ${KEY_MIN} x ${KEY_MIN} px`, small.length ? 'FAIL ' + small.map((e) => `${label(e)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`).join(', ') : 'ok']);
  const close = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i].getBoundingClientRect(), b = targets[j].getBoundingClientRect();
      const sep = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
      if (sep < KEY_GAP - 0.5) close.push(`${label(targets[i])} / ${label(targets[j])} ${sep.toFixed(1)}`);
    }
  }
  rows.push([`P4 at least ${KEY_GAP} px between targets`, close.length ? 'FAIL ' + close.join(', ') : 'ok']);
  const all = [...document.querySelectorAll('[data-action]')];
  const bad = all.filter((k) => !ACTIONS.includes(k.dataset.action) || BANNED.test(k.textContent)).map((k) => k.dataset.action);
  rows.push(["P5 only the page's controls: no Undo, Follow or Manual", bad.length ? 'FAIL ' + bad.join(', ') : 'ok']);
  const offscreen = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5; });
  rows.push(['P5 every control on the screen', offscreen.length ? 'FAIL ' + offscreen.map((e) => e.dataset.action).join(', ') : 'ok']);
  const de = document.documentElement;
  rows.push(['P6 one screen, no scroll', de.scrollHeight > innerHeight + 0.5 || de.scrollWidth > innerWidth + 0.5 ? `FAIL ${de.scrollWidth}x${de.scrollHeight}` : 'ok']);
  // What must be visible at once: while the class runs, the zone (number and name), the link slot,
  // the countdown, the metrics, the cue, the next row and the score or the band; before the start and
  // on "Class Complete", the gel, the link slot, the title, the facts, the zones and the band.
  const inView = (q) => { const el = document.querySelector(q); if (!el || !shown(el)) return false; const r = el.getBoundingClientRect(); return r.top >= -0.5 && r.bottom <= innerHeight + 0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5; };
  const bandShown = document.body.dataset.band === 'shown';
  const need = document.querySelector('.count')
    ? ['.gel .gel-num', '.gel .gel-name', '.rail .link', '.rail .val', '.count', '.metrics', '.cue', '.next', bandShown ? '.controls' : '.score']
    : ['.gel .gel-name', '.rail .link', '.intro h1', '.facts', '.zones', '.controls'];
  const missing = need.filter((q) => !inView(q));
  rows.push(['P6 visible at once', missing.length ? 'FAIL missing ' + missing.join(', ') : 'ok']);
  // P10: the two fonts of the design system only.
  const odd = [...document.querySelectorAll('[data-tier]')].filter((e) => !FACES.some((f) => getComputedStyle(e).fontFamily.startsWith(f))).map((e) => `${label(e)} ${getComputedStyle(e).fontFamily.slice(0, 24)}`);
  rows.push(['P10 the two fonts of the design system only', odd.length ? 'FAIL ' + odd.join(', ') : 'ok']);
  return rows;
}

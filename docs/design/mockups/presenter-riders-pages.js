// The presenter window with the riders panel (docs/design/riders-panel.md), one entry per state.
// `node presenter-riders-pages.js` writes presenter-riders-<name>.html beside this file. All
// nicknames and codes are made up. The window is the presenter's (presenter.html) with a riders
// row at the foot of the right column and, when opened, a drawer over the next song and the
// controls. The status lines and a resync notice stay above the drawer.
'use strict';
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Every text is a leaf with data-tier and data-min-cap (the smallest cap height in px: 17 px type
// has a 12 px cap, 15 px a 10.5 px cap), so measure.js checks it.
const L = (t, extra = '', lines = 1) => `<span data-tier="label" data-min-cap="10.5" data-lines="${lines}"${extra}>${esc(t)}</span>`;
const M = (t, extra = '', lines = 1) => `<span data-tier="minor" data-min-cap="11.8" data-lines="${lines}"${extra}>${esc(t)}</span>`;
const B = (label, o = {}) => `<button${o.cls ? ` class="${o.cls}"` : ''}${o.dis ? ' disabled' : ''} data-action="${o.action || ''}" data-tier="minor" data-min-cap="11.8" data-lines="${o.lines || 1}">${esc(label)}${o.sub ? `<span class="sub" data-tier="label" data-min-cap="10" data-lines="2">${esc(o.sub)}</span>` : ''}</button>`;

const pages = {};
const add = (name, title, comment, side) => { pages[name] = { title, comment, side }; };

// ---------- The presenter's own blocks (as in presenter.html) ----------
const STATUS = `<section class="status"><div><h2 data-tier="label" data-min-cap="10.5">Clock and music</h2>
  <p class="state" data-tier="minor" data-min-cap="11.8">Running</p><p class="state" data-tier="minor" data-min-cap="11.8">Following Spotify</p></div></section>`;
const NOTICE = `<div class="notice" role="status"><p data-tier="minor" data-min-cap="11.8" data-lines="3">Resynced, 30 s back<span>The music was paused while the link was lost.</span></p><button data-tier="minor" data-min-cap="11.8" data-action="undo">Undo</button></div>`;
const NEXTSONG = `<section class="song"><h2 data-tier="label" data-min-cap="10.5">Next song in 1:10</h2><p class="v" data-tier="minor" data-min-cap="11.8">Pulse Theory</p><p class="detail" data-tier="minor" data-min-cap="11.8" data-lines="2">Aurora Lane, 132 bpm, drop after 45 s</p></section>`;
const CONTROLS = `<section class="controls"><button class="main" data-tier="minor" data-min-cap="11.8" data-action="pause">Pause <span class="kbd" data-tier="label" data-min-cap="10">Space</span></button>
  <button data-tier="minor" data-min-cap="11.8" data-action="back">Back 5 s</button><button data-tier="minor" data-min-cap="11.8" data-action="forward">Forward 5 s</button>
  <button data-tier="minor" data-min-cap="11.8" data-action="next-song">Next song</button><button data-tier="minor" data-min-cap="11.8" data-action="manual">Manual clock</button>
  <button class="wide" data-tier="minor" data-min-cap="11.8" data-action="previous">Previous interval (stops following)</button></section>`;

// ---------- The riders row (closed) and the drawer (open) ----------
// row: what the row says. count, tag (a state in words), button.
const row = (o) => `<div class="foot"><div class="riders-row"><span class="count" data-tier="minor" data-min-cap="11.8">${esc(o.count)}</span><span class="what" data-tier="minor" data-min-cap="11.8">${esc(o.what || 'Riders')}</span>${o.tag ? L(o.tag, ' class="tag"') : ''}${o.button}</div>${o.note ? `<p class="state-line">${L(o.note)}</p>` : ''}</div>`;
const SHOW = B('Show list', { action: 'riders_show' });
const closed = (o) => STATUS + NOTICE + NEXTSONG + CONTROLS + row({ ...o, button: o.button || SHOW });
const closedNoNotice = (o) => STATUS + NEXTSONG + CONTROLS + row({ ...o, button: o.button || SHOW });

const NOTE = 'Remove takes a rider out of the class. A removed rider can scan again until you lock joining or make a new code.';
// The drawer. o: count, what, tag; lock (bool); acts (override); ask (confirm block); names (array
// of [nickname, state]); empty (message); dim (list greyed, buttons off).
function drawer(o) {
  const lock = o.lock ? B('Unlock joining', { action: 'unlock', sub: 'Joining is locked', dis: o.dim }) : B('Lock joining', { action: 'lock', sub: 'Joining is open', dis: o.dim });
  const newc = B('New code', { action: 'new_code', sub: o.newDis || 'Old code stops working', dis: o.dim || !!o.newDis });
  const acts = o.ask ? o.ask : `<div class="acts">${lock}${newc}</div>`;
  const state = o.stateLine ? `<p class="state-line">${o.stateLine.startsWith('<') ? o.stateLine : L(o.stateLine, '', 2)}</p>` : '';
  const items = o.empty ? `<li class="none" data-tier="minor" data-min-cap="11.8" data-lines="3">${esc(o.empty)}</li>`
    : (o.names || []).map(([n, st]) => (st === 'sure'
      ? `<li class="sure"><p data-tier="minor" data-min-cap="11.8" data-lines="3">Remove ${esc(n)} from the class?</p><div class="two">${B('Remove', { cls: 'go', action: 'remove_yes' })}${B('Keep', { action: 'remove_no' })}</div></li>`
      : `<li><span class="nick" dir="auto" data-tier="minor" data-min-cap="11.8" data-lines="2" data-clamp="2">${esc(n)}</span>${B('Remove', { action: 'remove', dis: o.dim })}</li>`)).join('');
  return `<section class="drawer"><div class="head"><span class="count" data-tier="minor" data-min-cap="11.8">${esc(o.count)}</span><span class="what" data-tier="minor" data-min-cap="11.8">${esc(o.what || 'Riders')}</span>${o.tag ? L(o.tag, ' class="tag"') : ''}${B('Hide list', { action: 'riders_hide' })}</div>`
    + `${acts}${state}${o.noNote ? '' : `<p class="state-line">${L(NOTE, '', 3)}</p>`}<ul class="names${o.dim ? ' dim' : ''}" data-scroll>${items}</ul></section>`;
}

const NAMES8 = ['Anna', 'Bo', 'Carlos', 'Dina', 'Erik', 'Fatima', 'Greta', 'Hugo'].map((n) => [n, '']);
const open = (o, notice = true) => STATUS + (notice ? NOTICE : '') + drawer(o);

add('closed', 'Presenter: riders row', 'State: 12 riders in, joining open. The row is the last thing in the right column; the count is always visible. "Show list" opens the drawer.',
  closed({ count: '12' }));
add('open', 'Presenter: riders panel', 'State: the drawer open, 8 riders in the order they joined, joining open. Remove, Lock joining and New code. The status and the resync notice stay above it.',
  open({ count: '8', names: NAMES8 }));
add('open-no-notice', 'Presenter: riders panel, no notice', 'State: as open, with no resync notice: the drawer has the room the notice took.',
  open({ count: '8', names: NAMES8 }, false));
add('confirm-remove', 'Presenter: remove a rider', 'State: Remove pressed on Bo. The row asks once; no answer in 5 s keeps him. The note says a removed rider can scan again.',
  open({ count: '8', names: ['Anna', 'Bo', 'Carlos', 'Dina'].map((n) => [n, n === 'Bo' ? 'sure' : '']) }));
add('locked', 'Presenter: joining locked', 'State: lock_state locked true. Riders already in stay; every new join is refused. The state is in words on the button and in the row.',
  open({ count: '8', lock: true, tag: 'Locked', stateLine: 'Joining is locked. Riders already in stay.', names: NAMES8 }));
add('confirm-new-code', 'Presenter: new code', 'State: New code pressed. One question with its consequences; Cancel keeps the code.',
  open({ count: '8', names: NAMES8, noNote: true, ask: `<div class="ask"><p data-tier="minor" data-min-cap="11.8" data-lines="2">Make a new code?</p><p class="state-line">${L('The old code and its QR code stop working. Riders already in stay. A control code shown here ends.', '', 4)}</p><div class="two">${B('Make new code', { cls: 'go', action: 'new_code_yes' })}${B('Cancel', { action: 'new_code_no' })}</div></div>` }));
add('new-code-made', 'Presenter: new code made', 'State: join_code came back. The new code is shown as text for 10 s; the room screen already shows it. The old one is gone everywhere.',
  open({ count: '8', names: NAMES8, stateLine: L('New code BCDF-GHJK. The room screen shows it now.', ' style="color:var(--light-1);font-weight:700"', 2) }));
add('new-code-limit', 'Presenter: new codes used up', 'State: this window has asked for 10 new codes in the last hour. New code is off until the hour is up (the server ignores more).',
  open({ count: '8', names: NAMES8, newDis: '10 an hour, used up' }));
add('empty', 'Presenter: no riders yet', 'State: join codes on, nobody in yet.',
  open({ count: '0', what: 'Riders', empty: 'No riders yet. Riders scan the QR code on the room screen.', noNote: true }));
add('off', 'Presenter: join codes off', 'State: no live session (ADR 0005 section 2: it starts on the instructor\'s request). The row offers it; the room screen has no codes.',
  closed({ count: '–', what: 'Riders', note: 'Join codes are off', button: B('Turn on join codes', { action: 'codes_on' }) }));
add('reconnecting', 'Presenter: reconnecting', 'State: the host connection dropped. The list is the last one seen, greyed; nothing can be pressed until the server replays the riders and the lock (ADR 0007 section 2).',
  open({ count: '8', tag: 'Reconnecting', dim: true, stateLine: 'Reconnecting. The list comes back when the connection does.', names: NAMES8 }));
add('full', 'Presenter: full, 60 riders', 'State: 60 riders connected, the cap of ADR 0002. The list scrolls; more riders cannot join, and the state says so in words.',
  open({ count: '60', tag: 'Full', stateLine: 'The class is full. More riders cannot join.', names: Array.from({ length: 60 }, (_, i) => [['Anna', 'Bo', 'Carlos', 'Dina', 'Erik', 'Fatima'][i % 6] + (i >= 6 ? ` ${Math.floor(i / 6) + 1}` : ''), '']) }));
add('long-names', 'Presenter: long nicknames', 'Worst case: 24-character nicknames of wide capitals and of one long word, two riders with the same nickname, markup and a lone dot. Each shows whole on at most two lines; the text is never interpreted.',
  open({ count: '6', names: [['WWWWWWWWWWWWWWWWWWWWWWWW', ''], ['Anna', ''], ['Anna', ''], ['Supercalifragilisticexp', ''], ['<b>Hugo</b> & co', ''], ['.', '']] }));

const NAMES = Object.keys(pages);
function html(n) {
  const { title, comment, side } = pages[n];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="presenter-riders.css">
</head>
<body>
<!-- ${comment}  Spec: docs/design/riders-panel.md. Generated by presenter-riders-pages.js: edit that, not this file. -->
<main>
  <h2 data-tier="label" data-min-cap="10.5">Room screen</h2>
  <div class="preview"><iframe src="room-running.html" title="Room screen preview" tabindex="-1"></iframe></div>
  <p class="cue" data-tier="minor" data-min-cap="11.8" data-lines="2">Find the beat and hold it. Breathe out on every second bar.</p>
  <div class="list3">
    <span class="chip z2" data-tier="minor" data-min-cap="11.8">2</span><span class="v" data-tier="minor" data-min-cap="11.8">Endurance</span><span class="v" data-tier="minor" data-min-cap="11.8">0:45</span><span class="v dim" data-tier="minor" data-min-cap="11.8">85–95 rpm</span><span class="v dim" data-tier="minor" data-min-cap="11.8">Seated</span>
    <span class="chip z5" data-tier="minor" data-min-cap="11.8">5</span><span class="v" data-tier="minor" data-min-cap="11.8">VO2 max</span><span class="v" data-tier="minor" data-min-cap="11.8">1:30</span><span class="v dim" data-tier="minor" data-min-cap="11.8">100–110 rpm</span><span class="v dim" data-tier="minor" data-min-cap="11.8">Standing</span>
    <span class="chip z3" data-tier="minor" data-min-cap="11.8">3</span><span class="v" data-tier="minor" data-min-cap="11.8">Tempo</span><span class="v" data-tier="minor" data-min-cap="11.8">1:30</span><span class="v dim" data-tier="minor" data-min-cap="11.8">On the beat</span><span class="v dim" data-tier="minor" data-min-cap="11.8">Seated</span>
  </div>
</main>
<aside class="side">
${side}
</aside>
</body>
</html>
`;
}
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `presenter-riders-${n}.html`), html(n));
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES };

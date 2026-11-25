// Connect Swedebeat, the mix states and the fall-back reasons (docs/design/swedebeat.md, ADR 0013).
// `node swedebeat-pages.js` writes class-list-swedebeat-<name>.html and room-mix-<name>.html beside
// this file. All names and numbers are made up. The class list pages follow class-list.md's markup;
// the room pages are room-before-start-manual.html and room-running.html with the link line changed.
'use strict';
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const M = (cap, text, extra = '') => `<span data-tier="minor" data-min-cap="${cap}"${extra}>${esc(text)}</span>`;
const L = (text) => `<span data-tier="label" data-min-cap="9.5" class="lbl">${esc(text)}</span>`;
const KBD = (k) => ` <span data-tier="label" data-min-cap="9.5" class="kbd">${k}</span>`;
const BTN = (text, k, cls = '') => `<button${cls ? ` class="${cls}"` : ''}>${M(12, text)}${k ? KBD(k) : ''}</button>`;

// ---------- The classes ----------
// [title, source line, length, updated, kind] kind: 'sw' a Swedebeat class, else not.
const CLASSES = [
  ['Beginners: find your legs', 'Spotify, 9 songs', '40:00', '2 Aug'],
  ['Friday party ride', 'Swedebeat, 15 songs', '1:00:00', '17 Oct', 'sw'],
  ['FTP test, 20 minutes', 'Spotify, 12 songs', '55:00', '30 Sep'],
  ['Hill repeats: six climbs of three minutes', 'Spotify, 13 songs', '50:00', '2 Nov'],
  ['Late summer long ride', 'Swedebeat, 18 songs', '1:15:00', '14 Dec 2025', 'sw'],
  ['Monday morning endurance', 'Swedebeat, 12 songs', '45:00', '9 Nov', 'sw'],
  ['Pyramid intervals', 'Spotify, 11 songs', '45:00', '4 Sep'],
  ['Recovery spin', 'Swedebeat, 7 songs', '30:00', '18 Sep', 'sw'],
  ['Short and sharp, 30 minutes', 'Spotify, 8 songs', '30:00', '21 Aug'],
  ['Sweet spot builder', 'Spotify, 10 songs', '40:00', '28 Oct'],
  ['Tempo and tension', 'Manual clock, no music', '45:00', '21 Oct'],
  ['Thursday threshold', 'Swedebeat, 11 songs', '42:00', 'Yesterday', 'sw'],
];

// The mix on a Swedebeat row. kinds: ready, down (with a percent), wait, bad, manual (a reason is
// on the Swedebeat line), none (the playback is off: nothing is added to the row).
const mix = (m) => {
  if (!m || m.k === 'none') return '';
  if (m.k === 'ready') return `<span class="mix"><span class="mark ok" aria-hidden="true"></span>${M(11, 'Mix ready')}</span>`;
  if (m.k === 'down') return `<span class="mix"><span class="mark work" aria-hidden="true"></span>${M(11, `Downloading the mix ${m.p}%`)}<span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.p}"><i style="width:${m.p}%"></i></span></span>`;
  if (m.k === 'wait') return `<span class="mix"><span class="mark work" aria-hidden="true"></span>${M(11, 'Mix waiting to download')}</span>`;
  if (m.k === 'bad') return `<span class="mix manual"><span class="mark away" aria-hidden="true"></span>${M(11, 'The mix could not be checked')}</span>`;
  return `<span class="mix manual"><span class="mark away" aria-hidden="true"></span>${M(11, 'Manual clock')}</span>`;
};
const rows = (sel, mixes, sw) => CLASSES.map(([t, src, len, upd, kind]) => `<div class="row${t === sel ? ' sel' : ''}">
    <div><div class="t">${M(15, t, ' data-lines="4"')}</div><div class="m">${M(11, src)}${kind === 'sw' && sw ? mix(mixes[t] || mixes['*']) : ''}</div></div>
    <span class="len">${M(18, len)}</span>
    <span class="upd">${M(11, upd)}</span>
  </div>`).join('\n');

const HEAD = `<header class="head">
  <div class="title"><h1 data-tier="minor" data-min-cap="28">Classes</h1>${M(11, '12 classes', ' class="count"')}</div>
  <button>${M(12, 'Open a class file…')}${KBD('Ctrl+O')}</button>
</header>`;
const SYNC = `<div class="status"><div class="what"><span class="mark ok" aria-hidden="true"></span><div>${M(14, 'Up to date', ' class="st"')}<div>${M(11, 'Paired as ana@example.com, “Studio PC”', ' data-lines="2" class="dt"')}</div></div></div></div>`;
const line = (mark, st, dt, btn) => `<div class="status sw"><div class="what"><span class="mark ${mark}" aria-hidden="true"></span><div>${M(14, st, ' class="st"')}<div>${M(11, dt, ' data-lines="2" class="dt"')}</div></div></div>${btn || ''}</div>`;
const plate = (st, dt, btns, second) => `<div class="plate${second ? ' second' : ''}" role="alert"><div>${M(14, st, ' data-lines="2" class="st"')}<div>${M(11, dt, ' data-lines="3" class="dt"')}</div></div><div class="row-btns" style="display:flex;gap:12px">${btns}</div></div>`;
const COLS = `<div class="cols">${L('Class')}${L('Length')}${L('Updated')}</div>`;
const foot = (t, dt, btn = 'Start class') => `<footer class="foot"><div class="sel"><div class="t">${M(15, t, ' data-lines="2" data-clamp="2"')}</div><div class="dt">${M(11, dt, ' data-lines="2"')}</div></div>${BTN(btn, 'Enter', 'primary').replace('data-min-cap="12"', 'data-min-cap="15"')}</footer>`;
const list = (mixes, sw) => `<div data-scroll class="list focus">${rows('Monday morning endurance', mixes, sw)}</div>`;
const SEL = 'Monday morning endurance';
const START = 'Starting opens the room screen and the presenter window';
const panel = (h2, body) => `<section class="panel"><h2 class="n" data-tier="minor" data-min-cap="28">${esc(h2)}</h2>${body}</section>`;
const P = (text, lines = 2) => `<p data-tier="minor" data-min-cap="14" data-lines="${lines}">${esc(text)}</p>`;
const FINE = (text) => `<p class="fine" data-tier="minor" data-min-cap="11" data-lines="3">${esc(text)}</p>`;
const field = (label, shown, focus) => `<div class="field-box">${L(label)}<div class="in${focus ? ' focus' : ''}">${shown ? `<span data-tier="minor" data-min-cap="13" data-lines="1">${shown}</span>` : ''}</div></div>`;
const form = (u, p) => `<div class="fields">${field('Username', u, true)}${field('Password', p, false)}</div>`;

const pages = {};
const add = (name, title, comment, body) => { pages[name] = { title, comment, body }; };
const MANUAL = { '*': { k: 'manual' } };
const NOTE = 'Swedebeat classes play on the manual clock.';

add('off', 'Class list: Swedebeat playback is off',
  'State: the default in every shipped build (UnavailableMixSource). The Swedebeat line shows the one fact and no field and no button. Rows are unchanged. Footer for a Swedebeat class names the clock.',
  `${HEAD}${SYNC}${line('away', 'Swedebeat playback is off', NOTE)}${COLS}${list({}, false)}${foot(SEL, 'Starting opens the room screen and the presenter window. Manual clock: Swedebeat playback is off')}`);
add('signed-out', 'Class list: Swedebeat is not connected',
  'State: a source is on, no token. The line offers "Connect Swedebeat". Each Swedebeat row says "Manual clock"; the footer gives the reason for the selected class.',
  `${HEAD}${SYNC}${line('away', 'Swedebeat is not connected', `${NOTE} Connect to play the mixes.`, BTN('Connect Swedebeat'))}${COLS}${list(MANUAL, true)}${foot(SEL, `${START}. Manual clock: Swedebeat is not connected`)}`);
add('form', 'Class list: Connect Swedebeat',
  'State: the form, in place of the list (as pairing takes the body). Fields come from credentialFields (here the fake: a username and a password). The password shows as dots only while typed, never as text; no show key. First field has the focus.',
  `${HEAD}${SYNC}${panel('Connect Swedebeat', `${P('Type the details you use for Swedebeat. They are used once to connect and are not kept.')}${form('ana.k', '••••••••••')}<div class="row-btns">${BTN('Connect', 'Enter', 'primary')}${BTN('Cancel', 'Esc')}</div>${FINE('Your password is not kept.')}`)}`);
add('connecting', 'Class list: connecting to Swedebeat',
  'State: the fields were cleared on submit; one call is out. No fields, no keys. The page does not wait longer than the main process answers (30 s at most, then "Swedebeat could not be reached").',
  `${HEAD}${SYNC}${line('work', 'Connecting to Swedebeat…', 'Your details were sent and have been cleared from this page')}${panel('One moment', P('Swedebeat classes can start on the manual clock meanwhile.'))}`);
const refused = (name, title, comment, st, dt) => add(name, title, comment,
  `${HEAD}${SYNC}${plate(st, dt, '', true)}${panel('Connect Swedebeat', `${form('', '')}<div class="row-btns">${BTN('Connect', 'Enter', 'primary')}${BTN('Cancel', 'Esc')}</div>`)}`);
refused('refused', 'Class list: Swedebeat did not accept the details', 'State: `bad_credentials`. The form is back with empty fields and the plate above it. Nothing was kept.',
  'Swedebeat did not accept those details', 'Check them and type them again. Nothing was kept.');
refused('rate-limited', 'Class list: too many tries', 'State: `rate_limited`. The form is back, empty.',
  'Too many tries', 'Wait a few minutes, then type your details again. Nothing was kept.');
// The page's own notes (core/mix/form-note.ts): the form stays open, fields as typed are not emptied.
const noted = (name, title, comment, st, dt, u, p) => add(name, title, comment,
  `${HEAD}${SYNC}${plate(st, dt, '', true)}${panel('Connect Swedebeat', `${form(u, p)}<div class="row-btns">${BTN('Connect', 'Enter', 'primary')}${BTN('Cancel', 'Esc')}</div>`)}`);
noted('form-missing', 'Class list: a field was left empty',
  'State: sw-form-missing. Connect was pressed with a field empty. The plate names the empty fields, lowercased, in the form\'s order ("a", "a and b", "a, b and c"); nothing was read or sent. Fields already filled stay as typed. With many fields the plate stays within three lines (W6).',
  'Type your password', 'Every field is needed to connect. Nothing was sent.', 'ana.k', '');
noted('form-not-sent', 'Class list: those details were not sent',
  'State: the shell answered that it did not take the details (no answer). The form is open and empty.',
  'Those details were not sent', 'Type them again. Nothing was kept.', '', '');
noted('form-unfinished', 'Class list: connecting did not finish',
  'State: the call to the shell failed. The page reads the shell again; the form is open and empty.',
  'Connecting did not finish', 'Type your details again to try once more.', '', '');
add('unreachable', 'Class list: Swedebeat could not be reached',
  'State: `unavailable`. Back on the list with the plate; the manual clock stays.',
  `${HEAD}${SYNC}${plate('Swedebeat could not be reached', `Check the connection, then try again. ${NOTE}`, BTN('Try again'), true)}${COLS}${list(MANUAL, true)}${foot(SEL, `${START}. Manual clock: Swedebeat is not connected`)}`);
add('signed-in', 'Class list: Swedebeat is connected',
  'State: a token is held. Rows show the mix: ready, downloading with a bar and its number, waiting its turn (one download at a time), and could not be checked. The footer says what Start will do.',
  `${HEAD}${SYNC}${line('ok', 'Swedebeat is connected', 'Mixes download in the background and play from this computer', BTN('Sign out of Swedebeat'))}${COLS}${list({ 'Friday party ride': { k: 'ready' }, 'Late summer long ride': { k: 'down', p: 63 }, 'Monday morning endurance': { k: 'ready' }, 'Recovery spin': { k: 'wait' }, 'Thursday threshold': { k: 'bad' } }, true)}${foot(SEL, 'Starting plays the mix and opens the room screen and the presenter window')}`);
add('reconnect', 'Class list: connect Swedebeat again',
  'State: the source said the token is no longer valid; only the token was deleted. Kept mixes stay on disk and play again after connecting.',
  `${HEAD}${SYNC}${plate('Swedebeat needs you to connect again', `The mixes saved on this computer are kept. ${NOTE}`, BTN('Connect Swedebeat again'), true)}${COLS}${list(MANUAL, true)}${foot(SEL, `${START}. Manual clock: Swedebeat is not connected`)}`);
add('no-keychain', 'Class list: no safe place for the sign-in',
  'State: keychainUsable is false. No button: there is no plain-text fallback.',
  `${HEAD}${SYNC}${line('away', 'Swedebeat cannot be connected here', `This computer has no safe place to keep the sign-in. ${NOTE}`)}${COLS}${list(MANUAL, true)}${foot(SEL, `${START}. Manual clock: Swedebeat cannot be connected here`)}`);
add('sign-out-ask', 'Class list: sign out of Swedebeat?',
  'State: asked before anything is deleted. "Keep connected" has the focus.',
  `${HEAD}${SYNC}${plate('Sign out of Swedebeat?', `The mixes saved on this computer are removed. ${NOTE}`, `${BTN('Sign out')}${BTN('Keep connected', 'Esc')}`, true)}${COLS}${list({ 'Friday party ride': { k: 'ready' }, 'Late summer long ride': { k: 'down', p: 63 }, 'Monday morning endurance': { k: 'ready' }, 'Recovery spin': { k: 'wait' }, 'Thursday threshold': { k: 'ready' } }, true)}${foot(SEL, 'Starting plays the mix and opens the room screen and the presenter window')}`);
add('signing-out', 'Class list: signing out of Swedebeat',
  'State: the key, the token and the mixes are being deleted, in that order (ADR 0013 section 1). Like clearing the saved classes: no list, no Start.',
  `${HEAD}${SYNC}${line('work', 'Signing out of Swedebeat', 'The mixes saved on this computer are being removed')}${panel('One moment', P('Nothing can start until this is done. You can still open a class file.'))}`);

const NAMES = Object.keys(pages);
const doc = (name) => {
  const { title, comment, body } = pages[name];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="class-list.css">
<link rel="stylesheet" href="swedebeat-list.css">
</head>
<body>
<!-- ${comment} Spec: docs/design/swedebeat.md. Generated by swedebeat-pages.js. -->
<div class="app">
${body}
</div>
<script>/* The selected row is scrolled into view, as the product does. */
var r = document.querySelector(".row.sel"); if (r) r.scrollIntoView({ block: "nearest" });</script>
</body>
</html>
`;
};

// ---------- The room screen ----------
const ROOMS = {
  'ready': ['room-before-start-manual.html', '<span class="link manual" data-tier="label">Press Start</span>', '<span class="link ready" data-tier="label">Mix ready</span>',
    'State: before the start, the class has a mix and it is cached and checked. White dot and words; Start plays it.'],
  'downloading': ['room-before-start-manual.html', '<span class="link manual" data-tier="label">Press Start</span>', '<span class="link work" data-tier="label">Downloading the mix 63%</span>',
    'State: before the start, the mix is on its way. Hollow dot, grey, the number in the words. Start still works: the mix plays while it downloads, and falls back (below) only if the sound would catch up with the download.'],
  'fallback': ['room-before-start-manual.html', '<span class="link manual" data-tier="label">Press Start</span>', '<span class="link manual" data-tier="label">Press Start · Swedebeat is not connected</span>',
    'State: before the start, the class is a Swedebeat class and plays on the manual clock. Grey square (a choice, not a fault: no plate); the reason follows "Press Start".'],
  'fallback-longest': ['room-before-start-manual.html', '<span class="link manual" data-tier="label">Press Start</span>', '<span class="link manual" data-tier="label">Press Start · Swedebeat cannot be connected here</span>',
    'State: before the start, the longest reason (no safe place for the sign-in). Checked at every room size.'],
  'playing': ['room-running.html', '<span class="link" data-tier="label">Following Spotify</span>', '<span class="link ready" data-tier="label">Playing the mix</span>',
    'State: running on the mix. The class clock is the audio position, so there is no "following", no bar count to lose and no link to lose.'],
  'fell-back': ['room-running.html', '<span class="link" data-tier="label">Following Spotify</span>', '<span class="link manual handover" data-tier="label">Mix still downloading</span>',
    'State: the mix fell back during play. White square and the reason for 30 s (news, as the hand-over), then grey "Manual clock"; the clock stays where it was and goes on; the audio has stopped.'],
};
const ROOM_NAMES = Object.keys(ROOMS);
const room = (name) => {
  const [src, from, to, comment] = ROOMS[name];
  let h = fs.readFileSync(path.join(__dirname, src), 'utf8');
  if (!h.includes(from)) throw new Error(`${src}: link line not found`);
  h = h.replace(from, to).replace('</head>', '<link rel="stylesheet" href="swedebeat-room.css">\n</head>');
  return h.replace(/<!-- State:[\s\S]*?-->/, `<!-- ${comment} Spec: docs/design/swedebeat.md. Generated by swedebeat-pages.js from ${src}. -->`);
};

if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `class-list-swedebeat-${n}.html`), doc(n));
  for (const n of ROOM_NAMES) fs.writeFileSync(path.join(__dirname, `room-mix-${n}.html`), room(n));
  console.log(`${NAMES.length + ROOM_NAMES.length} mock-ups written`);
}
module.exports = { NAMES, ROOM_NAMES };

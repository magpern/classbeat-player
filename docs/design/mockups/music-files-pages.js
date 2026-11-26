// The instructor's "music files" state (docs/design/music-files.md, ADR 0017).
// `node music-files-pages.js` writes class-list-music-files-<name>.html (the class list with a
// local class selected) and presenter-music-<name>.html (the presenter window mid-class) beside
// this file. All names, songs and file names are made up. The class list pages follow
// class-list.md's markup; the presenter pages are presenter.html with the music lines changed.
'use strict';
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const M = (cap, text, extra = '') => `<span data-tier="minor" data-min-cap="${cap}"${extra}>${esc(text)}</span>`;
const L = (text) => `<span data-tier="label" data-min-cap="9.5" class="lbl">${esc(text)}</span>`;
const KBD = (k) => ` <span data-tier="label" data-min-cap="9.5" class="kbd">${k}</span>`;
const BTN = (text, k, cls = '', dis = false) => `<button${cls ? ` class="${cls}"` : ''}${dis ? ' disabled' : ''}>${M(12, text)}${k ? KBD(k) : ''}</button>`;

// ---------- Plurals, in the words of the spec ----------
const files = (n) => `${n} music ${n === 1 ? 'file' : 'files'}`;
const missingWords = (m, n) => (m === n && n > 1 ? `All ${n} music files are missing` : `${files(m)} ${m === 1 ? 'is' : 'are'} missing`);
const stillWords = (m) => `${files(m)} ${m === 1 ? 'is' : 'are'} still missing`;
const foundWords = (n) => (n === 1 ? 'The music file is found' : `All ${n} music files are found`);

// ---------- The classes ----------
// [title, source line, length, updated, key] key: a local class whose files state is in FILES.
const CLASSES = [
  ['Beginners: find your legs', 'Spotify, 9 songs', '40:00', '2 Aug'],
  ['Friday party ride', 'Music files, 15 songs', '1:00:00', '17 Oct', 'friday'],
  ['FTP test, 20 minutes', 'Spotify, 12 songs', '55:00', '30 Sep'],
  ['Hill repeats: six climbs of three minutes', 'Spotify, 13 songs', '50:00', '2 Nov'],
  ['Late summer long ride', 'Swedebeat, 18 songs', '1:15:00', '14 Dec 2025'],
  ['Monday morning endurance', 'Spotify, 12 songs', '45:00', '9 Nov'],
  ['Pyramid intervals', 'Spotify, 11 songs', '45:00', '4 Sep'],
  ['Recovery spin', 'Music files, 7 songs', '30:00', '18 Sep', 'recovery'],
  ['Short and sharp, 30 minutes', 'Spotify, 8 songs', '30:00', '21 Aug'],
  ['Sweet spot builder', 'Spotify, 10 songs', '40:00', '28 Oct'],
  ['Tempo and tension', 'Manual clock, no music', '45:00', '21 Oct'],
  ['Thursday threshold', 'Music files, 11 songs', '42:00', 'Yesterday', 'sel'],
];
const SEL = 'Thursday threshold';

// A row's files marker. kinds: ok (filled circle), miss (hollow square, a count), work (hollow circle).
const fileMark = (k, m) => {
  if (!k) return '';
  if (k === 'ok') return `<span class="mix"><span class="mark ok" aria-hidden="true"></span>${M(11, 'Files found')}</span>`;
  if (k === 'work') return `<span class="mix"><span class="mark work" aria-hidden="true"></span>${M(11, 'Finding files…')}</span>`;
  return `<span class="mix manual"><span class="mark away" aria-hidden="true"></span>${M(11, `${m} ${m === 1 ? 'file' : 'files'} missing`)}</span>`;
};
const rows = (marks, titles = {}) => CLASSES.map(([t0, src, len, upd, key]) => {
  const t = titles[t0] || t0;
  return `<div class="row${t0 === SEL ? ' sel' : ''}">
    <div><div class="t">${M(15, t, ' data-lines="4"')}</div><div class="m">${M(11, src)}${key ? fileMark(...(marks[key] || [])) : ''}</div></div>
    <span class="len">${M(18, len)}</span>
    <span class="upd">${M(11, upd)}</span>
  </div>`;
}).join('\n');

const HEAD = `<header class="head">
  <div class="title"><h1 data-tier="minor" data-min-cap="28">Classes</h1>${M(11, '12 classes', ' class="count"')}</div>
  <button>${M(12, 'Open a class file…')}${KBD('Ctrl+O')}</button>
</header>`;
const SYNC = `<div class="status"><div class="what"><span class="mark ok" aria-hidden="true"></span><div>${M(14, 'Up to date', ' class="st"')}<div>${M(11, 'Paired as ana@example.com, “Studio PC”', ' data-lines="2" class="dt"')}</div></div></div></div>`;
const plate = (st, dt, btns) => `<div class="plate second" role="alert"><div>${M(14, st, ' data-lines="2" class="st"')}<div>${M(11, dt, ' data-lines="3" class="dt"')}</div></div><div class="row-btns" style="display:flex;gap:12px">${btns}</div></div>`;
const COLS = `<div class="cols">${L('Class')}${L('Length')}${L('Updated')}</div>`;
const list = (marks, titles) => `<div data-scroll class="list focus">${rows(marks, titles)}</div>`;

// The footer of a selected local class: the title, the files line (marker, words, a key to list
// the missing ones), the grey detail; "Find music files" and Start on the right.
const foot = ({ title = SEL, mark, words, detail, show = false, find = false, busy = false, startDt }) => `<footer class="foot files"><div class="sel"><div class="t">${M(15, title, ' data-lines="2" data-clamp="2"')}</div>
  <div class="fline" role="status"><span class="mark ${mark}" aria-hidden="true"></span>${M(12, words, ' class="st" data-lines="2"')}${show ? BTN('Show which files', '', 'small') : ''}</div>
  ${detail ? `<div class="dt">${M(11, detail, ' data-lines="3"')}</div>` : ''}</div>
  <div class="acts">${find ? BTN('Find music files', '', '', busy) : ''}${BTN('Start class', 'Enter', 'primary', busy).replace('data-min-cap="12"', 'data-min-cap="15"')}</div></footer>`;

const START = 'Starting opens the room screen and the presenter window';
const F = {
  found: foot({ mark: 'ok', words: foundWords(11), detail: 'Starting plays them from this computer and opens the room screen and the presenter window' }),
  missing: foot({ mark: 'away', words: missingWords(2, 11), show: true, find: true, detail: `${START}. Manual clock until they are found` }),
  allMissing: foot({ mark: 'away', words: missingWords(11, 11), show: true, find: true, detail: `${START}. Manual clock until they are found` }),
  one: foot({ mark: 'away', words: missingWords(1, 11), show: true, find: true, detail: `${START}. Manual clock until it is found` }),
  choosing: foot({ mark: 'work', words: 'Choose the folder with your music', find: true, busy: true, detail: 'A window from this computer is open. Starting waits until you have chosen' }),
  finding: foot({ mark: 'work', words: 'Finding music files…', find: true, busy: true, detail: 'Looking in the folder you chose and the folders inside it. Starting waits until this is done' }),
  still: foot({ mark: 'away', words: stillWords(2), show: true, find: true, detail: 'They were not in the folder you chose. Choose another folder, or start on the manual clock' }),
};

const pages = {};
const add = (name, title, comment, body) => { pages[name] = { title, comment, body }; };
const page = (marks, footer, titles, top = '') => `${HEAD}${SYNC}${top}${COLS}${list(marks, titles)}${footer}`;

add('found', 'Class list: all music files found',
  'State: the selected class has source local and every file is found and checked. Filled circle; no "Find music files" key (it is offered only while a file is missing). Start plays the files.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['ok'] }, F.found));
add('missing', 'Class list: some music files are missing',
  'State: 2 of 11 files are not found. Hollow square, the count, "Show which files" and "Find music files". Start still works: the class would run on the manual clock, and the footer says so.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['miss', 2] }, F.missing));
add('missing-one', 'Class list: one music file is missing',
  'State: one file is missing, for example one that changed or moved since it was found (the check before Start drops it). The words are singular; nothing else changes.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['miss', 1] }, F.one));
add('all-missing', 'Class list: no music files found yet',
  'State: a local class on a computer that has none of its files yet (a new device, or the first time). Every song is missing.',
  page({ friday: ['miss', 15], recovery: ['miss', 7], sel: ['miss', 11] }, F.allMissing));
add('choosing', 'Class list: choosing the folder',
  'State: "Find music files" was pressed and the operating system\'s folder window is open. The page shows no path and no folder name. Closing that window without choosing goes back to the state before, with no message. Both keys are held.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['work'] }, F.choosing));
add('finding', 'Class list: finding the music files',
  'State: a folder was chosen; the main process is looking. The answer carries no progress, so there is no number and no bar. Hollow circle, still. Both keys are held until the answer.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['work'] }, F.finding));
add('still-missing', 'Class list: files still missing after finding',
  'State: the find finished and some files are still missing. Same keys as "missing", with a detail that says what to do next.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['miss', 2] }, F.still));
add('find-failed', 'Class list: the search did not finish',
  'State: `player:music-files-find` failed. A plate above the list; nothing was changed. The footer drops its grey detail line, so five rows stay whole at 1000x720 (L3). No path or reason from the disk is shown.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['miss', 2] }, foot({ mark: 'away', words: missingWords(2, 11), show: true, find: true, detail: '' }), undefined, plate('The music files could not be searched', 'Nothing was changed. Try again, or start on the manual clock.', BTN('Try again'))));

// The worst case of the footer: a title of 80 characters in wide capitals (class.name), a long
// plural reason, at the smallest window.
const WIDE = 'WWWWWWWWWWWW MMMMMMMMMMMM WWWWWWWWWWWW MMMMMMMMMMMM WWWWWWWWWWWW MMMMMMM';
add('worst-footer', 'Class list: worst case, footer',
  'State: the longest class name (80 wide capitals) and the longest files line (all missing, the busiest keys). The title takes two lines in the footer, then an ellipsis; the rows keep the full title.',
  page({ friday: ['ok'], recovery: ['miss', 3], sel: ['miss', 11] }, foot({ title: WIDE, mark: 'away', words: missingWords(11, 11), show: true, find: true, detail: `${START}. Manual clock until they are found` }), { [SEL]: WIDE }));

// ---------- The list of missing files ----------
// [title, artist, file_name]
const MISS = [
  ['Neon Avenue', 'The Midnight Parade', 'neon_avenue_final_v2.mp3'],
  ['Pulse Theory', 'Aurora Lane', '07 Pulse Theory (radio edit).flac'],
];
const LONG = 'The very long title of a song that someone typed with every word the format allows, '.repeat(2).slice(0, 200).trim();
const LONGART = 'A band with a very long name, featuring a guest, and a second guest, and then another one, '.repeat(3).slice(0, 200).trim();
const LONGFILE = ('a-long-file-name-without-spaces_' + 'abcdefghij'.repeat(30)).slice(0, 252) + '.mp3';
const MISS_LONG = [
  [LONG, LONGART, LONGFILE],
  ['Pulse Theory', 'Aurora Lane', '07 Pulse Theory (radio edit).flac'],
  ['Neon Avenue', 'The Midnight Parade', 'neon_avenue_final_v2.mp3'],
  ['Slow Burn', 'Kestrel', 'kestrel_slow_burn.mp3'],
  ['Hold the Line', 'Aurora Lane', 'Hold the Line.m4a'],
  ['Last Light', 'The Midnight Parade', 'last light.wav'],
];
const missRows = (items) => items.map(([t, a, f]) => `<div class="mrow">
    <div><div class="t">${M(15, t, ' data-lines="5"')}</div><div class="m">${M(11, a, ' data-lines="5"')}</div></div>
    <div class="f">${M(11, f, ' data-lines="8"')}</div>
  </div>`).join('\n');
const missPanel = (items, count, total, buttons) => `<section class="files-panel"><h2 class="n" data-tier="minor" data-min-cap="28">Missing music files</h2>
  <p data-tier="minor" data-min-cap="14" data-lines="3">${esc(SEL)}: ${count} of ${total} music files are not found on this computer.</p>
  <div class="mcols">${L('Song')}${L('File name in the class')}</div>
  <div data-scroll class="mlist focus">${missRows(items)}</div>
  <div class="row-btns">${buttons}</div>
  <p class="fine" data-tier="minor" data-min-cap="11" data-lines="2">Files are matched by their content, not by name. Nothing leaves this computer.</p></section>`;
add('list', 'Class list: the missing music files',
  'State: "Show which files" was pressed. The panel takes the body in place of the list and the footer, as a form does. Each song: title and artist from the class, and the file_name the class document holds. No path, no folder.',
  `${HEAD}${SYNC}${missPanel(MISS, 2, 11, `${BTN('Find music files', 'Enter', 'primary')}${BTN('Back', 'Esc')}`)}`);
add('list-worst', 'Class list: missing files, worst case',
  'State: the longest title and artist (200 characters each), the longest file_name (255 characters, no spaces) and six songs, so the list scrolls. Everything wraps whole; nothing is cut.',
  `${HEAD}${SYNC}${missPanel(MISS_LONG, 6, 11, `${BTN('Find music files', 'Enter', 'primary')}${BTN('Back', 'Esc')}`)}`);

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
<link rel="stylesheet" href="music-files-list.css">
</head>
<body>
<!-- ${comment} Spec: docs/design/music-files.md. Generated by music-files-pages.js. -->
<div class="app">
${body}
</div>
<script>/* The selected row is scrolled into view, as the product does. */
var r = document.querySelector(".row.sel"); if (r) r.scrollIntoView({ block: "nearest" });</script>
</body>
</html>
`;
};

// ---------- The presenter window, mid-class ----------
const PRES = {
  stopped: { clock: 'Running', music: 'Manual clock, music stopped', detail: 'Neon Avenue could not be played',
    plate: ['The music stopped', 'Neon Avenue could not be read. The clock keeps running.'],
    comment: 'State: a file failed to read or decode in the middle of the class. The audio stopped at once; the clock did not. A plate in the resync notice\'s place, closed with Close or Esc; the music line keeps the fact afterwards. The room screen shows nothing of it.' },
  length: { clock: 'Running', music: 'Manual clock, music stopped', detail: 'Neon Avenue is the wrong length',
    plate: ['The music stopped', 'Neon Avenue is the wrong length. The clock keeps running.'],
    comment: 'State: the length check failed twice in a row mid-class (ADR 0017 section 3). Same plate, other reason.' },
  closed: { clock: 'Running', music: 'Manual clock, music stopped', detail: 'Neon Avenue could not be played', plate: null,
    comment: 'State: the notice was closed. The music line still says what happened, so nothing is lost by closing it.' },
  'missing-at-start': { clock: 'Running', music: 'Manual clock', detail: '2 music files were missing when the class started', plate: null,
    comment: 'State: the class was started with files missing. A choice made on the class list, not a fault: no plate. The list of the missing files is on the class list, before the start.' },
};
const PRES_NAMES = Object.keys(PRES);
const presenter = (name) => {
  const p = PRES[name];
  let h = fs.readFileSync(path.join(__dirname, 'presenter.html'), 'utf8');
  const swap = (from, to) => { if (!h.includes(from)) throw new Error(`presenter.html: ${from.slice(0, 40)} not found`); h = h.replace(from, to); };
  swap('<p class="state" data-tier="minor">Holding at the end of the song</p>', `<p class="state" data-tier="minor">${esc(p.clock)}</p>`);
  swap('<p class="state" data-tier="minor">Following Spotify</p>', `<p class="state" data-tier="minor">${esc(p.music)}</p>`);
  swap('<p class="detail" data-tier="minor" data-lines="2">Neon Avenue, 2:51 of 3:37. Crossfade planned 9 s, measured 6 s.</p>', `<p class="detail" data-tier="minor" data-lines="2">${esc(p.detail)}</p>`);
  const notice = /\s*<div class="notice" role="status">[\s\S]*?<\/div>/;
  if (!notice.test(h)) throw new Error('presenter.html: notice not found');
  h = h.replace(notice, p.plate ? `\n  <div class="notice" role="status">
    <p data-tier="minor" data-lines="3">${esc(p.plate[0])}<span>${esc(p.plate[1])}</span></p>
    <button data-tier="minor">Close <span class="kbd">Esc</span></button>
  </div>` : '');
  swap('src="room-running.html"', 'src="room-manual.html"');
  return h.replace(/<!-- Presenter window at[\s\S]*?-->/, `<!-- ${p.comment} Spec: docs/design/music-files.md. Generated by music-files-pages.js from presenter.html. -->`);
};

if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `class-list-music-files-${n}.html`), doc(n));
  for (const n of PRES_NAMES) fs.writeFileSync(path.join(__dirname, `presenter-music-${n}.html`), presenter(n));
  console.log(`${NAMES.length + PRES_NAMES.length} mock-ups written`);
}
module.exports = { NAMES, PRES_NAMES };

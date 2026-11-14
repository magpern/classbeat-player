// The web player page /play (docs/design/play.md), one entry per state. `node play-pages.js` writes
// play-<name>.html beside this file. Room states use play-kit.js (the room screen's markup, laid
// out by play.css); the class picker and its states use site-kit.js (the website's frame). All
// names, dates and numbers are made up. Run from anywhere.
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./play-kit');
const S = require('./site-kit');

const rooms = {};
const sites = {};
const addRoom = (name, title, comment, body, shown = false) => { rooms[name] = { title, comment, body, shown }; };
const addSite = (name, title, nav, body, comment) => { sites[name] = { title, nav, body, comment }; };

// ---------- The class ----------
const TITLE = 'Thursday threshold';
const FACTS = [['Length', '42:00'], ['Songs', '11'], ['Intervals', '24'], ['Class load', '58']];
const ZONES = [['1', '6:00', 'Recovery'], ['2', '11:30', 'Endurance, the aerobic base for long steady rides'], ['3', '8:00', 'Tempo'], ['4', '7:00', 'Threshold'],
  ['5', '5:00', 'VO2 max'], ['6', '3:00', 'Anaerobic capacity'], ['7', '1:30', 'Neuromuscular power']];

// The score, in seconds from now. Landscape shows 90 s behind and 270 s ahead; portrait 45 s and
// 135 s (play.md, "The score"). Anything that starts beyond the portrait window carries "pfar".
const START_SCORE = P.score(
  [[0, 360, 1, 'Recovery']],
  [[0, 232, 'Slow Sunrise', 'Harbour Lights', 104, 9.23], [232, 470, '', '', 0, 7.5]],
);
const RUN_SCORE = P.score(
  [[-228, -48, null], [-48, 192, 4, 'Threshold'], [192, 282, 5, 'VO2 max']],
  [[-100, 140, 'Slow Burn', 'Harbour Lights', 128, 7.5], [140, 380, 'Northern Line', 'The Quiet Hours', 132, 7.27]],
);
const END_SCORE = P.score([[-200, 0, null]], [[-150, 0, '', '', 0, 7.5]], [], 0);

const GEL_RUN = P.gel(4, 'Threshold', ['95–105% FTP', 'RPE 7–8']);
const GEL_FIRST = P.gel(1, 'Recovery', ['50–60% FTP', 'RPE 2–3'], { down: true, label: 'First zone' });
const MANUAL = { text: 'Manual clock', kind: 'manual' };
const running = (link = MANUAL) => [
  GEL_RUN,
  P.rail('27:40', '14:20', 'Main set: over-unders', link),
  P.clock('3:12'),
  P.metrics('90–100', 'Seated', '128'),
  P.cue('Settle in at threshold. Breathe out long, keep the shoulders soft.'),
  P.next(5, 'VO2 max', '1:30', '105 rpm', 'Standing'),
  RUN_SCORE,
].join('\n');
const before = (link) => [GEL_FIRST, P.rail(null, null, '', link), P.intro(TITLE, FACTS, ZONES), START_SCORE].join('\n');

// ---------- Room states ----------
addRoom('before-start', 'Play: before the start', 'State: the class is open, before Start. Lights down on the first zone; the band is pinned with Start until the class starts.',
  `${before({ text: 'Press Start', kind: 'manual' })}\n${P.band('start')}`, true);
addRoom('running', 'Play: running', 'State: running on the manual clock, the band hidden (a tap shows it).', running());
addRoom('running-band', 'Play: running, band shown', 'State: running, after a tap: the band over the score for 3 s after the last input.', `${running()}\n${P.band('pause')}`, true);
addRoom('paused', 'Play: paused', 'State: paused. Lights down, the "Paused" pill and its line; the band stays with Resume.',
  [P.gel(4, 'Threshold', ['95–105% FTP', 'RPE 7–8'], { down: true }), P.rail('27:40', '14:20', 'Main set: over-unders', MANUAL),
    P.clock('3:12', { pill: true, line: 'Starts again when resumed' }), P.metrics('90–100', 'Seated', '128'),
    P.cue('Settle in at threshold. Breathe out long, keep the shoulders soft.'), P.next(5, 'VO2 max', '1:30', '105 rpm', 'Standing'), RUN_SCORE, P.band('resume')].join('\n'), true);
addRoom('end-asked', 'Play: End asked', 'State: End pressed. The question replaces the buttons, "Keep going" in End\'s place; it closes by itself after 8 s.', `${running()}\n${P.band('ask')}`, true);
addRoom('finished', 'Play: Class Complete', 'State: the class has ended. House lights up: a white gel, no zone. The band is pinned with Close class.',
  [P.gel(null, '', [], { blank: true, length: '42:00' }), P.rail('0:00', '42:00', '', MANUAL), P.intro(TITLE, FACTS, ZONES), END_SCORE, P.band('close')].join('\n'), true);
addRoom('wake-refused', 'Play: screen may turn off', 'State: the browser refused to keep the screen awake. The rail says so, in white, for as long as it is refused; the class runs on.',
  running({ text: 'Screen may turn off', kind: 'manual handover' }));
addRoom('reloaded', 'Play: reloaded', 'State: the page was reloaded during a class. The class is opened again at its start; the rail says so until Start.',
  `${before({ text: 'Reloaded: back to the start', kind: 'manual handover' })}\n${P.band('start')}`, true);

// ---------- Worst cases ----------
const LONG = {
  title: 'Thursday threshold builder: long climbing intervals with a final all-out finish',
  z1: 'Recovery and very easy spinning, with loose legs and slow breathing all the way',
  z3: 'Tempo, comfortably hard and steady, the pace you could hold for a whole hour now',
  z7: 'Neuromuscular power: all-out sprints of a few seconds, from a rolling start, go!',
  seg: 'Main set, part two: the long climbing intervals before the final sprint finish!',
  song: 'The Extended Twelve-Inch Remix of a Very Long Song Title That Goes On and On',
  artist: 'Orchestra of the Northern Lights and Friends',
};
const T3 = ['105–120% FTP', 'RPE 9–10', '92–100% HRmax'];
const worst = () => [P.gel(3, LONG.z3, T3), P.rail('1:58:58', '1:05:55', LONG.seg, MANUAL), P.clock('58:58', { mmss: true }), P.metrics('105–120', 'Standing', '200'),
    P.cue('Uncompromisingly smooth: counterclockwise shoulders, breathe, recover, then accelerate progressively through the chorus.'),
    P.next(7, LONG.z7, '12:30', '105–120 rpm', 'Standing'),
    P.score([[-228, -48, null], [-48, 192, 3, LONG.z3], [192, 282, 7, LONG.z7]], [[-120, 160, LONG.song, LONG.artist, 200, 4.8], [160, 400, '', '', 0, 5.5]])].join('\n');
addRoom('worst', 'Play: worst case, running', 'Worst case: an 80-character zone name beside three targets, an 80-character segment and next name, an RPM range, MM:SS, 1:58:58 left, a 120-character cue with long words; the score under it.', worst());
addRoom('worst-band', 'Play: worst case, End asked', 'Worst case of the band: the End question, the widest band, over the worst running fixture.', `${worst()}\n${P.band('ask')}`, true);
addRoom('worst-before-start', 'Play: worst case, before the start', 'Worst case: before the start, an 80-character title, seven zones with 80-character names, the longest facts, three targets.',
  [P.gel(1, LONG.z1, T3, { down: true, label: 'First zone' }), P.rail(null, null, '', { text: 'Reloaded: back to the start', kind: 'manual handover' }),
    P.intro(LONG.title, [['Length', '2:12:00'], ['Songs', '28'], ['Intervals', '188'], ['Class load', '388']],
      [['1', '16:00', LONG.z1], ['2', '31:30', 'Endurance, the aerobic base for long steady rides at a conversational effort now'], ['3', '18:00', LONG.z3],
        ['4', '27:00', 'Functional threshold power, the hardest effort you can hold for about an hour'], ['5', '15:00', 'Maximal aerobic power, the VO2 max efforts of three to eight minutes at a time'],
        ['6', '13:00', 'Anaerobic capacity, short and very hard efforts well above your threshold power'], ['7', '11:30', LONG.z7]]),
    P.score([[0, 360, 1, LONG.z1]], [[0, 232, LONG.song, LONG.artist, 200, 4.8], [232, 470, '', '', 0, 5.5]]), P.band('start')].join('\n'), true);

// ---------- The class picker and the states around it (site.md's frame) ----------
const { T, h1, h2, p, small, btn, btns, field, plate, note, status, lab } = S;
const CLASSES = [
  ['Beginners: find your legs', '40:00', '2 Aug'], ['Friday party ride', '1:00:00', '17 Oct'], ['FTP test, 20 minutes', '55:00', '30 Sep'],
  ['Hill repeats: six climbs of three minutes', '50:00', '2 Nov'], ['Late summer long ride', '1:15:00', '14 Dec 2025'], ['Monday morning endurance', '45:00', '9 Nov'],
  ['Pyramid intervals', '45:00', '4 Sep'], ['Recovery spin', '30:00', '18 Sep'], ['Short and sharp, 30 minutes', '30:00', '21 Aug'],
  ['Sweet spot builder', '40:00', '28 Oct'], ['Tempo and tension', '45:00', '21 Oct'], ['Thursday threshold', '42:00', 'Yesterday'],
];
const classRow = ([t, len, chg]) => `<div class="row"><div class="t"><span class="a ul">${T('title', t, 4)}</span></div><span class="len">${T('len', len, 1)}</span><span class="src">${T('small', 'classbeat', 2)}</span><span class="chg">${T('small', chg, 2)}</span></div>`;
const cols = `<div class="cols">${['Class', 'Length', 'From', 'Changed'].map(lab).map((s) => `<span>${s}</span>`).join('')}</div>`;
const INTRO = p('Choose a class to run it here, on the manual clock. Once it is open it needs no internet; a reload starts it again from the beginning.');
const picker = (list, top = '') => `${h1('Play a class', `${list.length} classes`)}${top}${INTRO}${list.length >= 8 ? `<div class="filter">${field('Find a class', { ph: 'Type part of a title' })}</div>` : ''}${cols}<div class="rows has-cols">${list.map(classRow).join('')}</div>`;

addSite('picker', 'Play a class', 'none', picker(CLASSES), 'State: /play, twelve classes, A to Z. GET /api/site/classes, all pages loaded, then sorted. Each title opens /play#<class id>.');
addSite('picker-loading', 'Play a class: loading', 'none', `${h1('Play a class')}${status('Loading your classes…')}`, 'State: waiting for GET /api/site/classes.');
addSite('picker-empty', 'Play a class: none yet', 'none', `${h1('Play a class')}${h2('No classes yet')}${p('Classes you send from classbeat appear here, and on this page.')}${btns(btn('Classes', { primary: true }))}`, 'State: GET /api/site/classes with no classes.');
addSite('opening', 'Play: getting the class ready', 'none', `${h1('Play a class')}${status('Getting the class ready…')}`, 'State: /play#<class id>, waiting for the class (GET /api/site/classes/{class_id}, then its file). The last requests before Start.');
addSite('signed-out', 'Play: sign in', null, `${h1('Play a class')}${p('Sign in to see your classes and run one here.')}${btns(btn('Sign in', { primary: true, block: true }))}`, 'State: no session (401 not_signed_in). Sign in goes to /sign-in#return=play (or play.<class id>) and comes back here.');
addSite('session-ended', 'Play: session ended', null, `${h1('Play a class')}${note('Your session ended', 'Sign in again to carry on where you were.')}${btns(btn('Sign in', { primary: true, block: true }))}`, 'State: a session that ended (401 not_signed_in after one existed). Same way back as signed out.');
addSite('offline', 'Play: offline', 'none', `${h1('Play a class')}${plate('You are offline', 'Check your connection. Your classes cannot be fetched now. Once a class is open, it runs without the internet.', btn('Try again', { q: true }))}`, 'State: offline when the page opens (no answer to GET /api/site/classes). Nothing is stored, so there is nothing to show from before.');
addSite('not-found', 'Play: class not found', 'none', `${h1('That class is not here')}${p('It may have been deleted, or the link is not one of your classes.')}${btns(btn('Your classes', { primary: true }))}`, 'State: /play#<class id> answered 404 not_found (another account\'s id, a removed class). A malformed id is ignored and the picker shown.');

const NAMES = Object.keys(rooms);
const SITE_NAMES = Object.keys(sites);
if (require.main === module) {
  for (const n of NAMES) {
    const { title, comment, body, shown } = rooms[n];
    fs.writeFileSync(path.join(__dirname, `play-${n}.html`), P.room(title, comment, body, shown));
  }
  for (const n of SITE_NAMES) {
    const { title, nav, body, comment } = sites[n];
    fs.writeFileSync(path.join(__dirname, `play-${n}.html`), S.frame({ title, nav, body, comment }).replace('Spec: docs/design/site.md. Generated by site-pages.js', 'Spec: docs/design/play.md (frame: site.md). Generated by play-pages.js'));
  }
  console.log(`${NAMES.length + SITE_NAMES.length} mock-ups written`);
}
module.exports = { NAMES, SITE_NAMES };

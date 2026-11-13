// The handlebar companion mock-ups (docs/design/companion.md), one entry per state.
// `node companion-pages.js` writes companion-<name>.html beside this file. All names, codes and
// numbers are made up. Run from anywhere.
'use strict';
const fs = require('fs');
const path = require('path');
const { esc, T, top, gel, clock, cue, coming, key, keys, msg, runKeys, notice, note, doc } = require('./companion-kit');

const pages = {};
const add = (name, title, comment, body) => { pages[name] = { title, comment, body }; };
const run = (inner, cls = '') => `<main class="run${cls ? ' ' + cls : ''}">${inner}</main>`;
const page = (lead, act) => `<main class="page"><div class="lead">${lead}</div><div class="act">${act}</div></main>`;
const h1 = (t) => `<h1>${T('value', t, 2)}</h1>`;
const p = (t, small = false) => `<p${small ? ' class="small"' : ''}>${T(small ? 'label' : 'minor', t, 6)}</p>`;
const field = (label, o = {}) => `<div class="field${o.error ? ' err' : ''}">${T('label', label, 1, ' class="lab"')}<div class="input${o.focus ? ' focus' : ''}">`
  + (o.value ? T('value', o.value) : `<span class="ph">${T('label', o.ph || '', 1)}</span>`) + '</div>'
  + (o.error ? `<div class="err-line" role="alert">${T('label', o.error, 4)}</div>` : '') + '</div>';
const plate = (h, dt) => `<div class="plate" role="alert">${T('minor', h, 2, ' class="h"')}${dt ? T('label', dt, 4, ' class="dt"') : ''}</div>`;

// ---------- The class used by every running state ----------
const GEL4 = gel(4, 'Threshold', ['88–94% FTP', 'RPE 7–8']);
const CLOCK = clock('1:10', [['Cadence', '90–100', 'rpm'], ['Position', 'Seated']]);
const CUE = 'Find the beat and hold it. Breathe out on every second bar.';
const NEXT3 = [[2, 'Endurance', '0:45', '85–95', 'Seated'], [5, 'VO2 max', '3:00', '100–110', 'Standing'], [3, 'Tempo', '2:00', 'On the beat', 'Seated']];
const SONG = ['Next song', 'in <b>37</b> bars', 'Pulse Theory'];
const FOLLOW = top('Following Spotify', '', '23:41');

add('running', 'Companion: running', 'State: connected, class running, link locked, the song has beat anchors. Interval 6 of 14.',
  run(FOLLOW + GEL4 + CLOCK + cue(CUE) + coming(NEXT3, SONG) + runKeys({ follow: true })));

add('holding', 'Companion: holding Next interval', 'State: the thumb is on "Next interval", 0.48 s of the 0.8 s hold (60 %). Nothing is sent until the bar is full.',
  run(FOLLOW + GEL4 + CLOCK + cue(CUE) + coming(NEXT3, SONG) + runKeys({ follow: true, p: '60%' })));

add('skipped', 'Companion: skipped', 'State: a hold on "Next interval" was sent; the host answered and the new interval shows. The note stays 3 s.',
  run(top('Manual clock', 'manual', '22:31', 'left', note('Next interval: 5 VO2 max')) + gel(5, 'VO2 max', ['106–120% FTP', 'RPE 9']) + clock('3:00', [['Cadence', '100–110', 'rpm'], ['Position', 'Standing']])
    + cue('Out of the saddle. Three minutes, stay smooth, no bouncing.') + coming(NEXT3.slice(2).concat([[1, 'Recovery', '2:00', '80–90', 'Seated']]), ['Next song', 'in 0:48', 'Pulse Theory'])
    + runKeys()));

add('paused', 'Companion: paused', 'State: paused (the music app reports pause, or Pause on this phone). Lights down; Resume is a hold.',
  run(top('Music paused', 'alert', '23:41') + gel(4, 'Threshold', ['88–94% FTP', 'RPE 7–8'], { down: true })
    + clock('1:10', [['Cadence', '90–100', 'rpm'], ['Position', 'Seated']], { pill: 'Paused' }) + cue(CUE) + coming(NEXT3, SONG) + runKeys({ paused: true })));

add('resynced', 'Companion: resynced', 'State: the link locked again after the music was paused while readings were lost; the clock went 30 s back. One-touch undo.',
  run(FOLLOW + GEL4 + clock('1:40', [['Cadence', '90–100', 'rpm'], ['Position', 'Seated']]) + cue(CUE) + coming(NEXT3, ['Next song', 'in <b>52</b> bars', 'Pulse Theory'])
    + runKeys({ follow: true, notice: notice('Resynced, 30\u00a0s back', 'The music was paused while the link was lost.') })));

add('off-list', 'Companion: not a class song', 'State: something not in the class plays. The clock runs on by itself (estimated); no bar count.',
  run(top('Not a class song', 'alert', '23:41') + GEL4 + clock('1:10', [['Cadence', '90–100', 'rpm'], ['Position', 'Seated']], { label: 'Interval left, estimated', est: true })
    + cue(CUE) + coming(NEXT3, ['Next song', 'in about 1:22', 'Pulse Theory', true]) + runKeys()));

add('manual', 'Companion: manual clock', 'State: the manual clock (chosen, or no link). The next song change is counted in class time.',
  run(top('Manual clock', 'manual', '23:41') + GEL4 + clock('1:10', [['Cadence', 'On the beat', '', '128 bpm'], ['Position', 'Seated']])
    + cue(CUE) + coming(NEXT3, ['Next song', 'in 1:22', 'Pulse Theory']) + runKeys()));

add('stale', 'Companion: not hearing the computer', 'State: no state message for 3 s. The countdown dims; keys wait. After 10 s, or when the connection closes: "lost".',
  run(top('Not hearing the computer', 'alert', '23:41') + GEL4 + clock('1:07', [['Cadence', '90–100', 'rpm'], ['Position', 'Seated']], { label: 'Interval left, estimated', est: true })
    + cue(CUE) + coming(NEXT3, ['Next song', 'in about 1:19', 'Pulse Theory', true]) + keys(msg('Waiting for the computer'))));

add('last-interval', 'Companion: last interval', 'State: the class\'s final interval. Next interval cannot be pressed; "End of class" in the next rows.',
  run(top('Following Spotify', '', '2:30') + gel(1, 'Recovery', ['Under 55% FTP', 'RPE 2']) + clock('2:30', [['Cadence', '80–90', 'rpm'], ['Position', 'Seated']], { label: 'Last interval' })
    + cue('Easy spin. Shake out the legs and drink. Thank you, everyone.') + `<section class="coming">${T('label', 'Next', 1, ' class="lbl"')}<div class="next">${T('minor', 'End of class', 1, ' class="v"')}</div><div class="song">${T('label', 'Song ends', 1, ' class="lbl"')}<span class="v" data-tier="minor">in <b>48</b> bars</span></div></section>`
    + runKeys({ follow: true, last: true })));

add('before-start', 'Companion: before the start', 'State: connected, class loaded, clock at 0. Lights down on the first zone. Start is a hold.',
  run(top('Waiting for the first song', '', '42:00', 'class') + gel(2, 'Endurance', ['56–75% FTP', 'RPE 4'], { down: true, label: 'First zone' })
    + clock('5:00', [['Cadence', '85–95', 'rpm'], ['Position', 'Seated']], { label: 'First interval' })
    + cue('Thursday threshold', { label: 'Class', lines: 3 }) + coming([[3, 'Tempo', '4:00', '90–100', 'Seated'], [4, 'Threshold', '6:00', '90–100', 'Seated']], ['First song', '', 'Neon Avenue'])
    + keys(key('start', 'Start', { main: true, full: true, guard: 'hold', hint: 'Hold to start' }))));

add('finished', 'Companion: class complete', 'State: class time reached the end. Nothing left to steer; the computer ends the session.',
  run(top('Ended', 'manual', '42:00', 'ridden') + gel(0, 'Class complete', [], { blank: true, sub: '42:00 · 14 intervals · 11 songs' })
    + cue('Thursday threshold', { label: 'Class', lines: 3 }) + keys(msg('Nothing more to steer. The computer ends the session.'))));

// ---------- Worst cases: the longest and widest content the format allows ----------
// LONG_CUE: 120 characters of ordinary text with long words. WIDE_CUE: 120 characters all in
// capitals, much wider than ordinary text; the mock-up takes the last fitting step ("tighter").
const LONG_CUE = 'Overgeared, deliberately unhurried climbing: strengthening hamstrings, uncompromising breathing, unshakeable concentration';
const WIDE_CUE = 'STAND UP NOW: HEAVY GEARS, PUSH THROUGH THE ENTIRE CHORUS, NO SITTING DOWN UNTIL THE DROP. BREATHE, HOLD IT, KEEP SMOOTH';
const NAME80 = 'Maximal aerobic power with standing efforts and short seated recoveries between';
const TITLE80 = 'Wonderwall Remix (Extended Club Mix) feat. Somebody With A Remarkably Long Name';
const TG3 = ['106–120% FTP', 'RPE 9–10', '90–100% HRmax'];
const WORST = (tg = TG3) => top('Not a class song', 'alert', '1:58:58') + gel(7, NAME80, tg)
  + clock('58:58', [['Cadence', 'On the beat', '', '200 bpm'], ['Position', 'Standing']], { label: 'Interval left, estimated', est: true });
const NEXT80 = [[6, NAME80, '20:00', 'On the beat', 'Standing'], [7, NAME80, '20:00', 'On the beat', 'Standing']];
const SONG80 = ['Next song', 'in about 58:58', TITLE80, true];
add('worst', 'Companion: worst case', 'Worst case: 80-character zone name, three targets, 58:58, class time 1:58:58, "On the beat" at 200 bpm, "Standing", a 120-character cue of long words, 80-character names and title, keys whose presses stop following. Fitting step "tight": one next row, the key hints say "Hold".',
  run(WORST() + cue(LONG_CUE) + coming(NEXT80.slice(0, 1), SONG80) + runKeys({ follow: true, short: true }), 'tight'));
add('worst-notice', 'Companion: worst case with a notice', 'Worst case with the longest resync notice in place of the interval keys.',
  run(WORST() + cue(LONG_CUE) + coming(NEXT80.slice(0, 1), SONG80) + runKeys({ follow: true, notice: notice('Resynced, 1:05 forward', 'The music moved on while the link was lost.') }), 'tight'));
add('worst-wide', 'Companion: worst case, wide cue', 'Worst case by width: a 120-character cue all in capitals. Last fitting step "tighter": the coming rows go, the gel keeps its first target.',
  run(WORST(TG3.slice(0, 1)) + cue(WIDE_CUE) + runKeys({ follow: true, short: true }), 'tighter'));

// ---------- Getting control, and losing it ----------
const SIGNIN = p('Signed in on this phone? Sign in, then only the class code is needed.', true);
add('code', 'Companion: enter the codes', 'State: /control opened without a code (the QR code fills both fields and goes straight to "connecting"). Not signed in.',
  page(h1('Steer the class from this phone') + p('Scan the QR code in the presenter window, or type the two codes it shows.', true),
    field('Class code', { ph: '8 letters', value: 'BCDF-GHJK' }) + field('Control code', { ph: '8 letters', focus: true })
    + key('control', 'Get control', { main: true, full: true }) + SIGNIN));
add('code-signed-in', 'Companion: signed in', 'State: /control with a site session. The class code names the class; the sign-in gives control.',
  page(h1('Steer the class from this phone') + T('label', 'Signed in as ana@example.com', 2, ' class="who"'),
    field('Class code', { ph: '8 letters', focus: true }) + key('control', 'Steer this class', { main: true, full: true })
    + p('The class code is in the presenter window. Control needs the account that runs the class.', true)));
add('code-wrong', 'Companion: code did not work', 'State: invalid_code from POST /api/live/control (unknown class, wrong, used or expired code: one answer).',
  page(h1('Steer the class from this phone') + p('Scan the QR code in the presenter window, or type the two codes it shows.', true),
    field('Class code', { value: 'BCDF-GHJK' }) + field('Control code', { value: 'LMNP-QRST', error: 'That did not work. A control code works once, for 2 minutes. Ask the computer for a new one.' })
    + key('control', 'Get control', { main: true, full: true })));
add('connecting', 'Companion: connecting', 'State: a controller token was given; the WebSocket is opening and waiting for the first state message.',
  page(h1('Connecting to the class') + `<div class="work" role="status">${T('minor', 'Getting the class from the computer', 2)}</div>`,
    key('cancel', 'Cancel', { full: true })));
add('lost', 'Companion: connection lost', 'State: the connection closed, or no state message for 10 s. The phone tries again by itself. The class goes on on the computer.',
  page(plate('Connection lost', 'The class goes on on the computer. Trying again…') + gel(4, 'Threshold', [], { down: true, label: 'Last seen 0:12 ago' }),
    key('reconnect', 'Try again now', { full: true }) + p('Nothing you press here reaches the class until the phone is back.', true)));
add('taken', 'Companion: control taken', 'State: the server closed this connection because another phone took this control (close reason "replaced").',
  page(h1('Another phone has control') + p('The class goes on. This phone no longer steers it.', true),
    key('get_control', 'Get control again', { full: true }) + p('You need a new control code from the computer, or your sign-in.', true)));
add('dropped', 'Companion: control ended', 'State: the computer dropped this phone, or the sign-in that gave control ended (close reason "dropped" or "signed_out").',
  page(h1('This phone no longer steers the class') + p('The computer ended its control, or your sign-in ended. The class goes on.', true),
    key('get_control', 'Get control again', { full: true })));
add('ended', 'Companion: session ended', 'State: the live session ended (the computer ended it, it started a new one, or 12 hours passed).',
  page(h1('The class session has ended') + p('There is nothing more to steer.', true),
    key('get_control', 'Steer another class', { full: true })));

const NAMES = Object.keys(pages);
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `companion-${n}.html`), doc(pages[n].title, pages[n].comment, pages[n].body));
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES, pages, esc };

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
// Everything below comes from companion_state (schema/live/v1): status, classRemainingMs,
// now (zone number and name, cue, remainingMs), next (zone, lengthMs), nextSong (atMs, title,
// artist), link (mode, state, canUndo, announcement) and allowed. Nothing else.
const GEL4 = gel(4, 'Threshold');
const SONG = { when: 'in 1:22', title: 'Pulse Theory', artist: 'Neon Avenue' };
const CLOCK = clock('1:10', SONG);
const CUE = 'Find the beat and hold it. Breathe out on every second bar.';
const NEXT3 = [[2, 'Endurance', '0:45'], [5, 'VO2 max', '3:00'], [3, 'Tempo', '2:00']];
const FOLLOW = top('Following the music', '', '23:41');

add('running', 'Companion: running', 'State: status running, link following and locked. allowed: pause, skip. The nudges are greyed (never while following); skip goes to the next song.',
  run(FOLLOW + GEL4 + CLOCK + cue(CUE) + coming(NEXT3) + runKeys({ follow: true })));

add('holding', 'Companion: holding Next song', 'State: the thumb is on "Next song" (skip), 0.48 s of the 0.8 s hold (60 %). Nothing is sent until the bar is full.',
  run(FOLLOW + GEL4 + CLOCK + cue(CUE) + coming(NEXT3) + runKeys({ follow: true, p: '60%' })));

add('skipped', 'Companion: skipped', 'State: manual clock; a hold on "Next interval" sent skip and the ack came back applied. The new interval shows; the note stays 3 s.',
  run(top('Manual clock', 'manual', '22:31', 'left', note('Next interval: 5 VO2 max')) + gel(5, 'VO2 max') + clock('3:00', { when: 'in 0:48', title: 'Pulse Theory', artist: 'Neon Avenue' })
    + cue('Out of the saddle. Three minutes, stay smooth, no bouncing.') + coming([[3, 'Tempo', '2:00'], [1, 'Recovery', '2:00']])
    + runKeys()));

add('paused', 'Companion: paused', 'State: status paused, link following, state paused (the music app is paused). Lights down; Resume is a hold.',
  run(top('Music paused', 'alert', '23:41') + gel(4, 'Threshold', [], { down: true })
    + clock('1:10', SONG, { pill: 'Paused' }) + cue(CUE) + coming(NEXT3) + runKeys({ follow: true, paused: true })));

add('resynced', 'Companion: resynced', 'State: link.announcement resynced_back, seconds 30, canUndo true; allowed holds undo_resync. One-touch Undo in skip\'s row.',
  run(FOLLOW + GEL4 + clock('1:40', { when: 'in 1:52', title: 'Pulse Theory', artist: 'Neon Avenue' }) + cue(CUE) + coming(NEXT3)
    + runKeys({ follow: true, notice: notice('Resynced, 30 s back', 'Undo goes back and stops following.') })));

add('refused', 'Companion: refused', 'State: ack refused, reason would_stop_following (the music app could not be sent the next song). Shown 4 s in skip\'s row.',
  run(FOLLOW + GEL4 + CLOCK + cue(CUE) + coming(NEXT3)
    + runKeys({ follow: true, notice: notice('Not while following the music: use the computer', '', false) })));

add('off-list', 'Companion: not a class song', 'State: link state off_the_list. The clock runs on by itself, so the countdown and the song change are marked as estimates.',
  run(top('Not a class song', 'alert', '23:41') + GEL4 + clock('1:10', { ...SONG, when: 'in about 1:22', dim: true }, { label: 'Interval left, estimated', est: true })
    + cue(CUE) + coming(NEXT3) + runKeys({ follow: true })));

add('coasting', 'Companion: music not heard', 'State: link state coasting (the music is not heard). The clock runs on by itself, so the countdown and the song change are marked as estimates, as for a song that is not a class song.',
  run(top('Music not heard', 'alert', '23:41') + GEL4 + clock('1:10', { ...SONG, when: 'in about 1:22', dim: true }, { label: 'Interval left, estimated', est: true })
    + cue(CUE) + coming(NEXT3) + runKeys({ follow: true })));

add('ambiguous', 'Companion: song is in twice', 'State: link state ambiguous (the same recording is in the class twice). The clock is not estimated; the choice is made on the computer.',
  run(top('Song is in twice', 'alert', '23:41') + GEL4 + CLOCK + cue(CUE) + coming(NEXT3) + runKeys({ follow: true })));

add('manual', 'Companion: manual clock', 'State: link mode manual. allowed: pause, skip, nudge. The nudges work; skip goes to the next interval.',
  run(top('Manual clock', 'manual', '23:41') + GEL4 + CLOCK + cue(CUE) + coming(NEXT3) + runKeys()));

add('reconnecting', 'Companion: reconnecting', 'State: the phone\'s connection dropped under 10 s ago. The countdown runs on from the last state, marked not live; the keys are off. After 10 s: "not connected".',
  run(top('Reconnecting', 'alert', '23:38') + GEL4 + clock('1:07', SONG, { label: 'Not live', est: true })
    + cue(CUE) + coming(NEXT3) + keys(msg('Keys work again when the phone is back'))));

add('host-away', 'Companion: computer not connected', 'State: host_status connected false. The class goes on on the computer; the phone shows the last state, marked not live, for 10 s, then no countdown.',
  run(top('Computer not connected', 'alert', '23:38') + GEL4 + clock('1:07', SONG, { label: 'Not live', est: true })
    + cue(CUE) + coming(NEXT3) + keys(msg('Keys work again when the computer is back'))));

add('last-interval', 'Companion: last interval', 'State: next is empty and nextSong null, manual clock; skip is not in allowed. "End of class" in the next rows.',
  run(top('Manual clock', 'manual', '2:30') + gel(1, 'Recovery') + clock('2:30', null, { label: 'Last interval' })
    + cue('Easy spin. Shake out the legs and drink. Thank you, everyone.') + coming([])
    + runKeys({ noSkip: 'Last interval' })));

add('before-start', 'Companion: before the start', 'State: status not_started. Lights down on the first interval\'s zone, its cue and countdown. Start is a hold: the key says "Hold" ("Hold to start" shows only for 2 s after a short tap).',
  run(top('Not started', 'manual', '42:00', 'class') + gel(2, 'Endurance', [], { down: true, label: 'First zone' })
    + clock('5:00', { label: 'First song', when: 'at the start', title: 'Neon Avenue', artist: 'Glass Coast' }, { label: 'First interval' })
    + cue('Easy spin to warm up. Find your seat and settle in.') + coming([[3, 'Tempo', '4:00'], [4, 'Threshold', '6:00']])
    + keys(key('start', 'Start', { main: true, full: true, guard: 'hold', hint: 'Hold' }))));

add('finished', 'Companion: class complete', 'State: status ended. Nothing left to steer; the computer ends the session.',
  run(top('Ended', 'manual', '42:00', 'ridden') + gel(0, 'Class complete', [], { blank: true, sub: '42:00 ridden' })
    + keys(msg('Nothing more to steer. The computer ends the session.'))));

// ---------- Worst cases: the longest content the contract allows ----------
// LONG_CUE: 120 characters of ordinary text with long words. WIDE_CUE: 120 characters all in
// capitals, much wider than ordinary text; the mock-up takes the last fitting step ("tighter").
const LONG_CUE = 'Overgeared, deliberately unhurried climbing: strengthening hamstrings, uncompromising breathing, unshakeable concentration';
const WIDE_CUE = 'STAND UP NOW: HEAVY GEARS, PUSH THROUGH THE ENTIRE CHORUS, NO SITTING DOWN UNTIL THE DROP. BREATHE, HOLD IT, KEEP SMOOTH';
const NAME80 = 'Maximal aerobic power with standing efforts and short seated recoveries between';
const TITLE200 = 'Wonderwall Remix (Extended Club Mix) feat. Somebody With A Remarkably Long Name and Another Featured Artist, Live at the Very Large Arena, Remastered Anniversary Edition With Bonus Strings 2026 Mix';
const SONG200 = { when: 'in about 58:58', title: TITLE200, artist: TITLE200, dim: true };
const WORST = () => top('Not a class song', 'alert', '1:58:58') + gel(7, NAME80) + clock('58:58', SONG200, { label: 'Interval left, estimated', est: true });
const NEXT80 = [[6, NAME80, '20:00'], [7, NAME80, '20:00']];
add('worst', 'Companion: worst case', 'Worst case: 80-character zone name, 58:58, class time 1:58:58, a 120-character cue of long words, 80-character next names, 200-character song title and artist, estimated. Fitting step "tight": one next row.',
  run(WORST() + cue(LONG_CUE) + coming(NEXT80.slice(0, 1)) + runKeys({ follow: true }), 'tight'));
add('worst-notice', 'Companion: worst case with a notice', 'Worst case with the longest resync announcement in skip\'s row.',
  run(WORST() + cue(LONG_CUE) + coming(NEXT80.slice(0, 1)) + runKeys({ follow: true, notice: notice('Resynced, 1:05 forward', 'Undo goes back and stops following.') }), 'tight'));
add('worst-wide', 'Companion: worst case, wide cue', 'Worst case by width: a 120-character cue all in capitals. Last fitting step "tighter": the next rows go.',
  run(WORST() + cue(WIDE_CUE) + runKeys({ follow: true }), 'tighter'));

// ---------- Getting control, and losing it ----------
// One screen first (plan section 3): the usual way in is sign-in plus the class code the room
// screen shows. The control code exists only with a second display, in the presenter window.
const SECOND = p('Second display? The presenter window shows a control code and its QR code: scan it, or type the code here.', true);
add('code', 'Companion: get control', 'State: /control without a site session. Opened plain, or from a QR code of /control#<join code>, which only fills the class code. Sign-in is the way in; the control code is the second-display option.',
  page(h1('Steer the class from this phone') + p('Sign in with the account that runs the class, and type the class code from the room screen.', true)
    + field('Class code', { ph: '8 letters', value: 'BCDF-GHJK' }) + key('sign_in', 'Sign in to steer', { main: true, full: true }),
    SECOND + field('Control code', { ph: '8 letters' }) + key('control', 'Get control', { full: true })));
add('code-signed-in', 'Companion: signed in', 'State: /control with a site session. The class code names the class; the sign-in gives control.',
  page(h1('Steer the class from this phone') + T('label', 'Signed in as ana@example.com', 2, ' class="who"'),
    field('Class code', { ph: '8 letters', focus: true }) + key('control', 'Steer this class', { main: true, full: true })
    + p('The class code is on the room screen. Control needs the account that runs the class.', true)));
add('code-wrong', 'Companion: code did not work', 'State: invalid_code from POST /api/live/control (unknown class, wrong, used or expired code: one answer). cannot_control on the sign-in route reads alike, with its own words.',
  page(h1('Steer the class from this phone') + p('Sign in with the account that runs the class, and type the class code from the room screen.', true)
    + field('Class code', { value: 'BCDF-GHJK' }) + key('sign_in', 'Sign in to steer', { main: true, full: true }),
    SECOND + field('Control code', { value: 'LMNP-QRST', error: 'That did not work. A control code works once, for 2 minutes. Ask the computer for a new one.' })
    + key('control', 'Get control', { full: true })));
add('full', 'Companion: two phones already', 'State: controllers_full from POST /api/live/control: the code was right, both places are held. Dropping a phone ends that code (ADR 0005 section 3), so the field is cleared for a new one.',
  page(h1('Two phones already steer this class') + p('The class goes on. Drop a phone on the computer, then ask it for a new control code.', true),
    field('Class code', { value: 'BCDF-GHJK' }) + field('Control code', { ph: 'New code, 8 letters', focus: true })
    + key('control', 'Get control', { main: true, full: true })));
add('connecting', 'Companion: connecting', 'State: a controller token was given; the WebSocket is opening and waiting for the first state message.',
  page(h1('Connecting to the class') + `<div class="work" role="status">${T('minor', 'Getting the class from the computer', 2)}</div>`,
    key('cancel', 'Cancel', { full: true })));
add('lost', 'Companion: not connected', 'State: no connection for 10 s. No countdown. The phone tries again by itself with its token; the class goes on on the computer.',
  page(plate('Not connected', 'The class goes on on the computer. Trying again…') + gel(4, 'Threshold', [], { down: true, label: 'Last seen 0:12 ago' }),
    key('reconnect', 'Try again now', { full: true }) + p('Nothing you press here reaches the class until the phone is back.', true)));
add('dropped', 'Companion: control ended', 'State: ended, reason dropped: the computer freed this phone\'s place.',
  page(h1('This phone no longer steers the class') + p('The computer ended its control. The class goes on.', true),
    key('get_control', 'Get control again', { full: true }) + p('Sign in again, or ask the computer for a new control code.', true)));
add('ended', 'Companion: session ended', 'State: ended, reason host_ended, revoked or expired; or the token refused on reconnect (the live process restarted, or the sign-in ended: ADR 0005 section 6).',
  page(h1('The class session has ended') + p('There is nothing more to steer from this phone. If the class is still running, get control again.', true),
    key('get_control', 'Get control again', { full: true })));

const NAMES = Object.keys(pages);
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `companion-${n}.html`), doc(pages[n].title, pages[n].comment, pages[n].body));
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES, pages, esc };

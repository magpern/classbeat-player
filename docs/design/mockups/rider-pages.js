// The rider page mock-ups (docs/design/rider.md), one entry per state. `node rider-pages.js`
// writes rider-<name>.html beside this file. All names, codes and numbers are made up.
// The class view comes from rider_state (ADR 0007 section 2): status, classRemainingMs, now (zone
// number and name, position, test, remainingMs), next (zone, lengthMs, position) and effort
// ranges per zone. Nothing else: no cue, no song, no other rider.
'use strict';
const fs = require('fs');
const path = require('path');
const K = require('./rider-kit');
const { T, gel, coming, key, top, clock, effort, run, myKey, page, h1, p, field, remember, plate, doc } = K;

const pages = {};
const add = (name, title, comment, body) => { pages[name] = { title, comment, body }; };

// ---------- The class, as the rider sees it ----------
const NEXT3 = [[2, 'Endurance', '0:45'], [5, 'VO2 max', '3:00'], [3, 'Tempo', '2:00']];
// Zone 4 "Threshold": 88 to 94 % FTP, 85 to 92 % of maximum heart rate, RPE 7 to 8. With an FTP of
// 250 W and a maximum heart rate of 185 bpm: 220 to 235 W and 157 to 170 bpm.
const NUMBERS = effort([['Power', '220–235', 'W'], ['Heart rate', '157–170', 'bpm'], ['RPE', '7–8', '']]);
const PERCENT = effort([['Power', '88–94%', 'FTP'], ['Heart rate', '85–92%', 'max'], ['RPE', '7–8', '']],
  'Add your FTP and max heart rate in My numbers to see watts and beats.');
const ME = 'Joined as Anna';

add('running', 'Rider: in the class', 'State: connected, status running, hostConnected true. FTP 250 and maximum heart rate 185 are on the phone, so the effort is in watts and beats per minute.',
  run(top(ME, '', '23:41') + gel(4, 'Threshold') + clock('1:10', 'Seated') + NUMBERS + coming(NEXT3) + myKey()));

add('running-percent', 'Rider: in the class, no numbers', 'State: as running, but the rider typed no FTP and no maximum heart rate: the effort shows as percentages and the RPE, with a line that says where to add them.',
  run(top(ME, '', '23:41') + gel(4, 'Threshold') + clock('1:10', 'Seated') + PERCENT + coming(NEXT3) + myKey()));

add('ftp-test', 'Rider: FTP test', 'State: now.test is {kind: ftp, minutes: 20}. The label sits in the gel; the effort is whatever the zone carries (here RPE only).',
  run(top(ME, '', '17:30') + gel(5, 'VO2 max', [], { label: 'FTP test, 20 min' }) + clock('12:00', 'Seated') + effort([['RPE', '9–10', '']]) + coming([[1, 'Recovery', '5:00']]) + myKey()));

add('before-start', 'Rider: before the start', 'State: status not_started, hostConnected true. Lights down on the first zone, the first interval and its countdown; nothing runs yet.',
  run(top(ME, '', '42:00', 'class') + gel(2, 'Endurance', [], { down: true, label: 'First zone' }) + clock('5:00', 'Seated', { label: 'First interval' })
    + effort([['Power', '125–150', 'W'], ['Heart rate', '111–130', 'bpm'], ['RPE', '3–4', '']]) + coming([[3, 'Tempo', '4:00'], [4, 'Threshold', '6:00']]) + myKey()));

add('paused', 'Rider: paused', 'State: status paused. Lights down: the gel goes dark and the colour moves into the glyphs. A "Paused" pill before "Interval left"; the countdown holds.',
  run(top(ME, '', '23:41') + gel(4, 'Threshold', [], { down: true }) + clock('1:10', 'Seated', { pill: 'Paused' }) + NUMBERS + coming(NEXT3) + myKey()));

add('holding', 'Rider: until the next song', 'State: status holding (the clock waits for the next song to start). The countdown\'s label says so, as on the room screen.',
  run(top(ME, '', '23:41') + gel(4, 'Threshold') + clock('0:00', 'Seated', { label: 'Until the next song' }) + NUMBERS + coming(NEXT3) + myKey()));

add('last-interval', 'Rider: last interval', 'State: next is empty. "End of class" in the next rows.',
  run(top(ME, '', '2:30') + gel(1, 'Recovery') + clock('2:30', 'Seated', { label: 'Last interval' })
    + effort([['Power', '125–150', 'W'], ['Heart rate', '111–130', 'bpm'], ['RPE', '2–3', '']]) + coming([]) + myKey()));

add('finished', 'Rider: class complete', 'State: status ended (the class is over; the session may still be open). A white gel, never a zone colour.',
  run(top(ME, '', '42:00', 'ridden') + gel(0, 'Class complete', [], { blank: true, sub: '42:00 ridden' })
    + `<p class="done">${T('minor', 'Thank you for riding.', 2)}</p>`));

add('host-away', 'Rider: waiting for the instructor', 'State: welcome or host_status with hostConnected false, after a state was shown. The last interval stays, lights down; the countdown is marked not live and does not run on (ADR 0007 section 5).',
  run(top('Waiting for the instructor', 'alert', '23:38') + gel(4, 'Threshold', [], { down: true }) + clock('1:07', 'Seated', { label: 'Interval left, not live', est: true })
    + NUMBERS + coming(NEXT3) + myKey()));

add('reconnecting', 'Rider: reconnecting', 'State: the phone\'s own connection dropped under 10 s ago. The countdown runs on from the last state, marked not live. After 10 s it goes (as the companion).',
  run(top('Reconnecting', 'alert', '23:38') + gel(4, 'Threshold') + clock('1:07', 'Seated', { label: 'Interval left, not live', est: true })
    + NUMBERS + coming(NEXT3) + myKey()));

add('waiting', 'Rider: waiting, nothing to show yet', 'State: joined, hostConnected false and no state has arrived yet (the class is not open on the computer).',
  page(h1('Waiting for the instructor') + p('You are in. The class shows here when the instructor is back.', true)
    + `<div class="work" role="status">${T('minor', 'Joined as Anna', 1)}</div>`, ''));

// ---------- Joining ----------
const codeLine = () => `<p class="code-line"><span data-tier="label">Class code <span class="v n">KXPD-RMTB</span></span></p>`;
const NICK = field('Nickname', { ph: '1 to 24 characters' });
const NUMBERS_IN = (o = {}) => `<div class="pair">${field('FTP, in watts (optional)', { ph: 'e.g. 250', ...(o.ftp || {}) })}${field('Max heart rate, in bpm (optional)', { ph: 'e.g. 185', ...(o.hr || {}) })}</div>`;
const PRIVACY = p('Your instructor sees your nickname. FTP and max heart rate stay on this phone and are never sent.', true);
const LEAD = (extra = '') => h1('Join the class') + codeLine() + extra + PRIVACY;

add('enter', 'Rider: join', 'State: /j#KXPD-RMTB opened, nothing typed, nothing remembered. Remember is off. Join needs a nickname.',
  page(LEAD(), NICK + NUMBERS_IN() + remember(false) + `<div class="duo solo">${key('join', 'Join the class', { main: true })}</div>`, 'form'));

add('enter-remembered', 'Rider: join, remembered', 'State: this phone remembered an FTP and a maximum heart rate. They are filled in, Remember is on and Forget is shown. The nickname is not remembered.',
  page(LEAD(), field('Nickname', { ph: '1 to 24 characters', focus: true }) + NUMBERS_IN({ ftp: { value: '250' }, hr: { value: '185' } }) + remember(true)
    + `<div class="duo">${key('forget', 'Forget')}${key('join', 'Join the class', { main: true })}</div>`, 'form'));

add('enter-error', 'Rider: join, errors', 'State: Join pressed with no nickname and an FTP out of range. Nothing was sent; the fields keep what was typed.',
  page(LEAD(), field('Nickname', { ph: '1 to 24 characters', error: 'Type a nickname, 1 to 24 characters.' })
    + NUMBERS_IN({ ftp: { value: '2500', error: 'FTP is a whole number from 50 to 600.' } }) + remember(false)
    + `<div class="duo solo">${key('join', 'Join the class', { main: true })}</div>`, 'form'));

add('enter-no-code', 'Rider: join, no code in the address', 'State: /j opened with no code in the address (the QR code was not scanned). The class code is typed.',
  page(h1('Join the class') + p('Type the class code from the room screen.', true) + PRIVACY,
    field('Class code', { ph: '8 letters', focus: true }) + NICK + NUMBERS_IN() + remember(false)
    + `<div class="duo solo">${key('join', 'Join the class', { main: true })}</div>`, 'form'));

add('away', 'Rider: away too long', 'State: the rider token lapsed (5 minutes without a connection) or the tab was closed. The code is still in the address, so the form is back with what was typed or remembered.',
  page(h1('Join the class') + codeLine() + plate('You were away too long', 'Join again to get back in.') + PRIVACY,
    field('Nickname', { value: 'Anna' }) + NUMBERS_IN({ ftp: { value: '250' }, hr: { value: '185' } }) + remember(true)
    + `<div class="duo">${key('forget', 'Forget')}${key('join', 'Join the class', { main: true })}</div>`, 'form'));

add('joining', 'Rider: joining', 'State: POST /api/live/join sent, then the WebSocket hello, waiting for welcome. The fields are locked; Join cannot be pressed twice.',
  page(h1('Joining the class') + codeLine() + `<div class="work" role="status">${T('minor', 'Getting you into the class', 2)}</div>`,
    field('Nickname', { value: 'Anna', dim: true }) + NUMBERS_IN({ ftp: { value: '250', dim: true }, hr: { value: '185', dim: true } }) + remember(true, true)
    + `<div class="duo solo">${key('join', 'Joining…', { dis: true })}</div>`, 'form'));

add('not-joined', 'Rider: could not join', 'State: cannot_join, one answer for every cause (unknown code, old code, locked, full). The words say nothing about why (ADR 0007 section 5).',
  page(h1('Could not join') + p('Check the code with your instructor.') + codeLine(),
    key('retry', 'Try again', { main: true, full: true })));

add('removed', 'Rider: removed', 'State: ended with reason dropped (the instructor removed this rider). No rejoin button: scanning the code again works unless the instructor has locked joining or made a new code.',
  page(h1('The instructor removed you from this class', 3) + p('To join again, scan the code on the room screen.', true), ''));

add('ended', 'Rider: ended', 'State: ended with reason host_ended, revoked or expired. Nothing more to show.',
  page(h1('The class has ended') + p('You can close this page.', true), ''));

add('my-numbers', 'Rider: my numbers', 'State: the "My numbers" key of the class view was pressed. The same fields in a sheet over the view; the view goes on underneath and is back on Done.',
  page(h1('My numbers') + p('Used on this phone to work out your effort. Never sent.', true),
    NUMBERS_IN({ ftp: { value: '250', focus: true }, hr: { value: '185' } }) + remember(false) + `<div class="duo">${key('forget', 'Forget')}${key('done', 'Done', { main: true })}</div>`, 'form'));

// ---------- Worst cases: the longest content the contract allows ----------
// A 24-character nickname of wide capitals, an 80-character zone name, class time 1:58:58,
// 58:58, three-digit watts, three effort rows, 80-character next names.
const NAME80 = 'Maximal aerobic power with standing efforts and short seated recoveries between';
const NICK24 = 'WWWWWWWWWWWWWWWWWWWWWWWW';
const WORST_NEXT = [[6, NAME80, '20:00'], [7, NAME80, '20:00'], [3, NAME80, '20:00']];
add('worst', 'Rider: worst case', 'Worst case: a 24-character nickname of wide capitals, an 80-character zone name, 58:58, class time 1:58:58, the FTP test label, three-digit watts and beats on three rows, three 80-character next names.',
  run(top(`Joined as ${NICK24}`, '', '1:58:58') + gel(7, NAME80, [], { label: 'FTP test, 20 min' }) + clock('58:58', 'Standing')
    + effort([['Power', '675–900', 'W'], ['Heart rate', '184–230', 'bpm'], ['RPE', '10', '']]) + coming(WORST_NEXT) + myKey()));
add('worst-percent', 'Rider: worst case, no numbers', 'Worst case without numbers: the percentages, the longest hint, and the same long names.',
  run(top(`Joined as ${NICK24}`, '', '1:58:58') + gel(7, NAME80) + clock('58:58', 'Standing')
    + effort([['Power', '112–150%', 'FTP'], ['Heart rate', '85–100%', 'max'], ['RPE', '10', '']], 'Add your FTP and max heart rate in My numbers to see watts and beats.')
    + coming(WORST_NEXT) + myKey()));
add('worst-form', 'Rider: worst case, join', 'Worst case of the form: a 24-character nickname, the longest errors, a four-digit FTP.',
  page(h1('Join the class') + codeLine() + PRIVACY,
    field('Nickname', { value: NICK24 }) + NUMBERS_IN({ ftp: { value: '99999', error: 'FTP is a whole number from 50 to 600.' }, hr: { value: '99999', error: 'Max heart rate is a whole number from 80 to 230.' } })
    + remember(true) + `<div class="duo">${key('forget', 'Forget')}${key('join', 'Join the class', { main: true })}</div>`, 'form'));

const NAMES = Object.keys(pages);
// The states that scroll vertically (a form, with the keyboard up).
const FORMS = ['enter', 'enter-remembered', 'enter-error', 'enter-no-code', 'away', 'joining', 'my-numbers', 'worst-form'];
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `rider-${n}.html`), doc(pages[n].title, pages[n].comment, pages[n].body));
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES, FORMS, pages };

// The Android app's own screens (docs/design/app.md and the app-*.md specs), one entry per state.
// `node app-pages.js` writes app-<name>.html beside this file. All names, codes, addresses and
// numbers are made up. Native screens carry data-layer="native": they are drawn by Kotlin with the
// same tokens and fonts, and these pages are their reference only.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./app-kit');
const { T, key, page, h1, p, field, plate, native, strip, mode, code, steps, work, note, duo, stack, band, doc, roomDoc, R, P } = A;

const pages = {};
// kind: 'page' (a full-screen page) or 'room' (the class screen); spec: the spec file.
const add = (name, spec, title, comment, body, o = {}) => { pages[name] = { spec, title, comment, body, kind: o.room ? 'room' : 'page', shown: !!o.shown, form: !!o.form, display: !!o.display }; };

// ---------- Modes (app-modes.md) ----------
const NICK = field('Nickname', { ph: '1 to 24 characters' });
const NUMBERS_IN = (o = {}) => `<div class="pair">${field('FTP, in watts (optional)', { ph: 'e.g. 250', ...(o.ftp || {}) })}${field('Max heart rate, in bpm (optional)', { ph: 'e.g. 185', ...(o.hr || {}) })}</div>`;
const PRIVACY = p('Your instructor sees your nickname. FTP and max heart rate stay on this phone and are never sent.', true);
const JOIN = key('join', 'Join the class', { main: true });
// The rider's start page, step 1 of the join: the class code alone (the app is never opened from
// the QR code's address, so it never arrives with a code), "Continue", and the mode strip under it.
// Step 2 is the rider page's own join form (rider.md, rider-enter) with the code on a line.
const riderStart = (o = {}) => page(
  mode('Rider mode') + h1('Join a class') + (o.plate || '') + p('Type the class code from the room screen.', true),
  field('Class code', { ph: 'XXXX-XXXX', focus: !o.code, ...(o.code || {}) }) + duo(key('continue', 'Continue', { main: true }))
  + strip('Switch to instructor mode', o.paired ? 'Teaching? Your screen lock opens instructor mode.' : 'Teaching? Switch to pair this phone with your account.'),
  'form');
const codeLine = (c) => `<p class="code-line"><span data-tier="label">Class code <span class="v n">${c}</span></span></p>`;
const joinDetails = (o = {}) => page(
  mode('Rider mode') + h1('Join the class') + codeLine('KXPD-RMTB') + PRIVACY,
  (o.nick || field('Nickname', { ph: '1 to 24 characters', focus: true })) + NUMBERS_IN() + R.remember(false) + duo(key('cancel', 'Back'), JOIN),
  'form');

add('rider-start', 'app-modes.md', 'App: first launch, rider mode', 'State: first launch on an unpaired phone (ADR 0011 section 1): rider mode, the join form, and the mode strip saying how to start teaching.',
  riderStart(), { form: true });

add('rider-start-paired', 'app-modes.md', 'App: rider mode, paired', 'State: rider mode on a paired phone (the last mode used). The strip says the screen lock opens instructor mode.',
  riderStart({ paired: true }), { form: true });

add('lock-cancelled', 'app-modes.md', 'App: screen lock not confirmed', 'State: "Switch to instructor mode" pressed on a paired phone; the system screen-lock prompt was cancelled or failed. Rider mode stays, nothing changed; a plate says so.',
  riderStart({ paired: true, plate: plate('Still in rider mode', 'Instructor mode opens only after your screen lock.') }), { form: true });

add('no-lock', 'app-modes.md', 'App: a screen lock is needed', 'State: "Switch to instructor mode" on a paired phone with no secure screen lock (ADR 0011 section 1). Native screen. No instructor mode until one is set.',
  native(page(mode('Rider mode') + h1('A screen lock is needed') + p('Instructor mode opens only after this phone\'s screen lock: a PIN, pattern or password.')
    + note('This phone has no screen lock. Your classes and the pairing stay on it, locked away until you set one.'),
  stack(key('set_lock', 'Set a screen lock', { main: true, full: true }), key('stay_rider', 'Stay in rider mode', { full: true })))));

const CLASSES = [['Tempo builder', '45 min · 11 songs'], ['Hill repeats', '50 min · 12 songs'], ['Friday recovery ride', '30 min · 8 songs']];
const row = ([t, f]) => `<button class="key row" data-action="open_class"><span class="kl" data-tier="minor" data-lines="2">${A.esc(t)}</span><span class="kh" data-tier="label">${A.esc(f)}</span></button>`;
// "Unpair this phone": an outlined key (64 px high, words at --c-minor) on the status row.
const unpairKey = '<button class="key quiet" data-action="unpair"><span class="kl" data-tier="minor" data-lines="2">Unpair this phone</span></button>';
add('instructor-start', 'app-modes.md', 'App: instructor mode', 'State: instructor mode after the screen lock, the class list (class-list.md, laid out for the phone) and the mode strip. "Unpair this phone" is on the status row. No strip while a class is open.',
  page(mode('Instructor mode') + h1('Classes') + `<div class="status">${T('label', 'Up to date', 1, ' class="ok"')}${unpairKey}</div>`,
    `<div class="rows">${CLASSES.map(row).join('')}</div>` + strip('Switch to rider mode')));

// The pairing ran out (class-list.md "Pairing ran out"): the plate stands in for the status line.
add('instructor-start-expired', 'app-modes.md', 'App: instructor mode, pairing ran out', 'State: the saved classes stay; the server said the token expired. The plate carries the words and "Pair again"; the status line is hidden. The mock-up shows two classes so that it fits at every size; with three classes at 360x640 the page scrolls (app-modes.md, A8 note).',
  page(mode('Instructor mode') + h1('Classes') + `<div class="status">${unpairKey}</div>`
    + plate('The pairing has run out', 'Pair again to get new and changed classes. Saved classes still play.').replace(/<\/div>$/, key('pair_again', 'Pair again') + '</div>'),
    `<div class="rows">${CLASSES.slice(0, 2).map(row).join('')}</div>` + strip('Switch to rider mode')));

add('to-rider-ask', 'app-modes.md', 'App: switch to rider mode?', 'State: "Switch to rider mode" pressed in instructor mode. Native question; "Stay" has the focus. Back or no answer is "Stay".',
  native(page(mode('Instructor mode') + h1('Switch to rider mode?') + p('The class list closes and the music is no longer followed. Coming back to instructor mode needs your screen lock.'),
    duo(key('stay', 'Stay', { main: true }), key('switch_mode', 'Switch')).replace('class="key main"', 'class="key main focus"'))));

add('unpair-ask', 'app-modes.md', 'App: unpair this phone?', 'State: "Unpair this phone" pressed in instructor mode. Native question; "Stay" has the focus. Back or leaving the app is "Stay". "Unpair" removes the saved classes and goes to the switching screen, then rider mode.',
  native(page(mode('Instructor mode') + h1('Unpair this phone?') + p('The classes saved on this phone are removed and instructor mode closes. Teaching from it again needs a new pairing.'),
    duo(key('stay', 'Stay', { main: true }), key('unpair', 'Unpair')).replace('class="key main"', 'class="key main focus"'))));

add('switching', 'app-modes.md', 'App: switching to rider mode', 'State: "Switch" pressed. Native screen while the follower stops, the connections close and the web view reloads fresh (ADR 0011 section 1). Under a second.',
  native(page(mode('Rider mode') + h1('Switching to rider mode') + work('Closing instructor mode'), '')));

add('switching-instructor', 'app-modes.md', 'App: switching to instructor mode', 'State: the screen lock passed. Native screen while the rider\'s numbers and the web view\'s storage are dropped and the page reloads fresh (ADR 0011 section 1). Under a second.',
  native(page(mode('Instructor mode') + h1('Switching to instructor mode') + work('Closing rider mode'), '')));

// ---------- Pairing (app-pairing.md) ----------
const URL = 'https://player.example/pair';
const PAIR_STEPS = steps([`Open ${URL}: the button below opens it in your browser`, 'Sign in and type the code', 'Confirm only if this phone shows the same code']);
// The steps sit with the keys: beside the code in landscape, under it in portrait.
const pairing = (lead, o = {}) => native(page(mode('Instructor mode') + h1('Pair this phone') + lead,
  PAIR_STEPS + duo(key('cancel', 'Cancel'), key('open_site', o.again ? 'Open the page again' : 'Open the site', { main: true }))));

add('pair-asking', 'app-pairing.md', 'App: asking for a code', 'State: "Switch to instructor mode" on an unpaired phone; the app asks the server for a code (ADR 0002). Cancel goes back to rider mode.',
  native(page(mode('Instructor mode') + h1('Pair this phone') + work('Asking the server for a code'), duo(key('cancel', 'Cancel')))));

add('pair-code', 'app-pairing.md', 'App: the pairing code', 'State: a code is shown, 9:41 left. "Open the site" opens the pair page in a Custom Tab (or the browser); the code can also be typed on another device.',
  pairing(code('WDJB-MJHT') + T('label', 'The code runs out in 9:41', 1, ' class="left"')));

add('pair-code-no-lock', 'app-pairing.md', 'App: pairing, no screen lock', 'State: as the code, on a phone with no screen lock. Pairing goes on; a note says instructor mode will need a lock.',
  pairing(code('WDJB-MJHT') + T('label', 'The code runs out in 9:41', 1, ' class="left"')
    + note('This phone has no screen lock. Instructor mode will need one: set it before or after pairing.')));

add('pair-waiting', 'app-pairing.md', 'App: waiting for the approval', 'State: back from the browser before the approval came. The code stays; the app asks every 5 s. "Open the page again" reopens the tab.',
  pairing(work('Not yet confirmed on the website') + code('WDJB-MJHT') + T('label', 'The code runs out in 6:12', 1, ' class="left"'), { again: true }));

add('pair-done', 'app-pairing.md', 'App: paired', 'State: the approval came and the token is kept under the Android Keystore. Next: the system screen-lock prompt, then the class list.',
  native(page(mode('Instructor mode') + h1('This phone is paired') + `<div class="status m">${T('minor', 'Paired as anna@example.com', 2, ' class="ok"')}</div>`
    + p('Confirm your screen lock to open instructor mode.', true), duo(key('continue', 'Continue', { main: true })))));

// A pairing notice: NOTICE_TEXT (core/pairing/view.ts) in the app's words, on a plate.
const notice = (name, title, text, detail, again = true, state = name.replace('-', '_')) => add(`pair-${name}`, 'app-pairing.md', `App: pairing, ${title}`, `State: pairing ended with ${state}. The plate carries the notice; ${again ? '"Start again" asks for a new code' : 'there is nothing to try again'}.`,
  native(page(mode('Instructor mode') + h1('Pair this phone') + plate(text, detail), again ? stack(key('pair_again', 'Start again', { main: true, full: true }), key('stay_rider', 'Rider mode', { full: true })) : duo(key('stay_rider', 'Back to rider mode', { main: true })))));
notice('denied', 'refused', 'Refused on the website.', 'Nothing was kept on this phone.');
notice('code-expired', 'code ran out', 'The code ran out.', 'It was not confirmed in time. Start again for a new code.');
notice('unreachable', 'no server', 'The server could not be reached.', 'Check the connection, then start again.');
notice('no-keystore', 'no Keystore', 'This phone cannot be paired.', 'It has no Android Keystore, so there is no safe place for the pairing. Rider mode works without it.', false);
notice('too-many', 'too many pairings', 'Too many pairings were started.', 'Try again in an hour.');
notice('unexpected', 'answer not understood', 'The answer was not understood.', "The app could not read the server's answer. Try again later.");
notice('save-failed', 'not kept', 'The pairing could not be kept.', 'The Android Keystore did not keep it, so the pairing was undone. Start again.');
notice('revoked', 'unpaired on the site', 'Unpaired on the website.', 'The classes saved on this phone were removed.');

// iOS (app-pairing-ios.md): only the pages whose words differ from Android's. Every other iOS
// pairing page is the Android page above, unchanged.
add('pair-ios-done', 'app-pairing-ios.md', 'App (iOS): paired', 'State: the approval came and the token is kept in the Keychain. Next: the system prompt (Face ID, Touch ID or the passcode), then the class list.',
  native(page(mode('Instructor mode') + h1('This phone is paired') + `<div class="status m">${T('minor', 'Paired as anna@example.com', 2, ' class="ok"')}</div>`
    + p('Confirm it is you to open instructor mode.', true), duo(key('continue', 'Continue', { main: true })))));
notice('ios-no-passcode', 'no passcode (iOS)', 'This phone cannot be paired.', 'Pairing needs a passcode to keep it safe. Set one in Settings, then start again. Rider mode works without it.', true, 'no_keychain');
notice('ios-save-failed', 'not kept (iOS)', 'The pairing could not be kept.', 'The Keychain did not keep it, so the pairing was undone. Start again.', true, 'save_failed');

// ---------- Following the music (app-follow.md) ----------
const TITLE = 'Tempo builder';
const FACTS = [['Length', '45:00'], ['Songs', '11'], ['Intervals', '14']];
const ZONES = [['1', '6:00', 'Recovery'], ['2', '12:00', 'Endurance'], ['3', '14:00', 'Tempo'], ['4', '9:00', 'Threshold'], ['5', '4:00', 'VO2 max']];
// The score, in seconds from now (play-pages.js, the same shapes).
const START_SCORE = P.score([[0, 360, 1, 'Recovery']], [[0, 232, 'Slow Sunrise', 'Harbour Lights', 104, 9.23], [232, 470, '', '', 0, 7.5]]);
const RUN_SCORE = P.score([[-228, -48, null], [-48, 192, 3, 'Tempo'], [192, 282, 4, 'Threshold']],
  [[-100, 140, 'Slow Burn', 'Harbour Lights', 128, 7.5], [140, 380, 'Northern Line', 'The Quiet Hours', 132, 7.27]]);
const GEL_FIRST = P.gel(1, 'Recovery', ['50–60% FTP', 'RPE 2–3'], { down: true, label: 'First zone' });
const before = (link) => [GEL_FIRST, P.rail(null, null, '', link), P.intro(TITLE, FACTS, ZONES), START_SCORE].join('\n');
const running = (link) => [P.gel(3, 'Tempo', ['76–90% FTP', 'RPE 5–6']), P.rail('31:40', '13:20', 'Main set', link), P.clock('2:10'),
  P.metrics('85–95', 'Seated', '128'), P.cue('Settle in, hold it steady'), P.next(4, 'Threshold', '3:00', '90 rpm', 'Standing'),
  RUN_SCORE].join('\n');

add('follow-before', 'app-follow.md', 'App: before the start, manual clock', 'State: a class open in instructor mode, notification access not given. The link slot says "Press Start" (the manual clock); the band has "Follow the music".',
  before({ text: 'Press Start', kind: 'manual' }) + '\n' + band('start', { follow: true }), { room: true, shown: true });

add('follow-ask', 'app-follow.md', 'App: follow the music?', 'State: "Follow the music" pressed without notification access (ADR 0011 section 6). Native sheet: why, what is read, the link to the setting, and the manual clock.',
  native(page(mode('Instructor mode') + h1('Follow the music on this phone') + p('When a song starts, pauses or moves on, the class clock goes with it.')
    + p('Only Notification access lets an app see what Spotify plays. The player reads Spotify\'s song, play or pause and position only: no other notification, no message.', true),
  stack(key('open_setting', 'Open the setting', { main: true, full: true }), key('not_now', 'Not now: manual clock', { full: true })))));

add('follow-still-off', 'app-follow.md', 'App: access still off', 'State: back from the setting without access. The same sheet with the steps, including Android\'s "restricted setting" step for an app installed outside a store.',
  native(page(mode('Instructor mode') + h1('Notification access is still off')
    + steps(['Open the setting', 'Find classbeat in the list and turn it on', 'If Android says restricted: App info for classbeat, three dots, Allow restricted settings']),
  stack(key('open_setting', 'Open the setting', { main: true, full: true }), key('not_now', 'Not now: manual clock', { full: true })))));

add('follow-waiting', 'app-follow.md', 'App: following, before the first song', 'State: access given, following on, before the start. The link slot says "Waiting for the first song" (room-2d.md); "Follow the music" is gone.',
  before({ text: 'Waiting for the first song', kind: '' }) + '\n' + band('start'), { room: true, shown: true });

add('follow-lost', 'app-follow.md', 'App: access taken away', 'State: notification access was turned off while a class ran. The clock goes on by hand; for 30 s the link slot says "Following stopped" in white (room-2d.md, the hand-over). Nothing is a fault.',
  running({ text: 'Following stopped', kind: 'manual handover' }), { room: true });

add('follow-manual', 'app-follow.md', 'App: running on the manual clock', 'State: running on the manual clock, after the 30 s, the band shown. "Manual clock" in grey with the square marker; "Follow the music" opens the sheet again.',
  running({ text: 'Manual clock', kind: 'manual' }) + '\n' + band('pause', { follow: true }), { room: true, shown: true });

// ---------- Rider join in the app (app-rider-join.md) ----------
add('join-details', 'app-rider-join.md', 'App: join, step 2', 'State: "Continue" pressed with a code of the right shape. The rider page\'s join form (rider.md), the code on a line; Back returns to step 1 with the code kept.',
  joinDetails(), { form: true });

add('join-code-error', 'app-rider-join.md', 'App: join, the code is wrong', 'State: "Continue" pressed with a 7-letter code. Nothing was sent; the field keeps what was typed.',
  riderStart({ code: { value: 'KXPD-RMT', error: 'Codes are 8 letters.' } }), { form: true });

add('join-error', 'app-rider-join.md', 'App: join, no nickname', 'State: "Join the class" pressed with no nickname. Nothing was sent; the other fields keep what was typed.',
  joinDetails({ nick: field('Nickname', { ph: '1 to 24 characters', error: 'Type a nickname, 1 to 24 characters.' }) }), { form: true });

add('leave-ask', 'app-rider-join.md', 'App: leave the class?', 'State: Back pressed while joined. The page asks; "Keep riding" has the focus. Leaving closes the rider socket and drops the rider token (ADR 0011 section 1).',
  page(h1('Leave the class?') + p('To join again, type the class code again.', true),
    duo(key('leave', 'Leave'), key('keep_riding', 'Keep riding', { main: true })).replace('class="key main"', 'class="key main focus"')));

// ---------- The room view on an external display (app-room-display.md) ----------
add('display-idle', 'app-room-display.md', 'App: external display, no class open', 'State: a display is connected and no class is open on the phone. The stage stays dark with one line; nothing else.',
  `<main class="idle">${T('text', 'The class shows here when it opens on the phone', 2)}</main>`, { room: true, display: true });

add('display-idle-rider', 'app-room-display.md', 'App: external display, rider mode', 'State: a display is connected and the phone is in rider mode, in any page or a joined class. The same dark stage as the instructor idle, with the rider line; nothing of the rider, the class or other riders.',
  `<main class="idle">${T('text', 'Your class is on your phone', 2)}</main>`, { room: true, display: true });

add('display-lost', 'app-room-display.md', 'App: the display went away', 'State: the display was unplugged or the cast ended during the class. The phone goes on as it was; for 30 s the link slot says so in white.',
  running({ text: 'Room screen disconnected', kind: 'manual handover' }), { room: true });

const NAMES = Object.keys(pages);
const FORMS = NAMES.filter((n) => pages[n].form);
const ROOMS = NAMES.filter((n) => pages[n].kind === 'room' && !pages[n].display);
const DISPLAYS = NAMES.filter((n) => pages[n].display);
if (require.main === module) {
  for (const n of NAMES) {
    const g = pages[n];
    const html = g.kind === 'room' ? roomDoc(g.title, g.comment, g.spec, g.body, g.shown) : doc(g.title, g.comment, g.spec, g.body);
    fs.writeFileSync(path.join(__dirname, `app-${n}.html`), html);
  }
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES, FORMS, ROOMS, DISPLAYS, pages };

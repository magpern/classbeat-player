// Which mock-up is captured and checked at which size. Shared by shoot.js and measure.js.
// ONLY=<regex> limits both to the matching shots.
'use strict';

const STATES = ['before-start', 'running', 'paused', 'coasting', 'off-list', 'ambiguous', 'manual', 'last-interval', 'finished', 'ftp-test'];

// States added for strings that had no mock-up (issue #78): "99+", "Change in", "Until the next
// song", "Press Start". Each is also checked at the narrowest ratio of each layout.
const MORE = ['long-interval', 'change-in', 'hold', 'before-start-manual'];

// Every room size and ratio the spec supports (room-2d.md, "Sizes"): from 21:9 down to 5:4,
// the smallest of each layout, and both sides of the 3:2 switch point.
const SIZES = [
  [2560, 1080], // 21:9, the widest
  [1920, 1080], // 16:9
  [1280, 720], // 16:9, the smallest room size
  [1680, 1050], // 16:10
  [1280, 800], // 16:10, small
  [1650, 1080], // 1.53:1, the narrowest ratio of the wide layout
  [1620, 1080], // 3:2, the widest ratio of the narrow layout
  [1440, 1080], // 4:3
  [1024, 768], // 4:3, the smallest
  [1280, 1024], // 5:4, the narrowest
];

// The worst case of every text slot: the longest content the format allows (ADR 0003), and by
// width (wide capitals, single 80-character words). Static HTML; each fixture lists its worst
// cases in a header comment.
// The room screen's own controls (room-2d.md, "Controls on the room screen"), shown. The worst
// case of the band is checked at every size.
const CONTROLS = ['controls-before-start', 'controls-running', 'controls-paused', 'controls-manual', 'controls-no-code', 'controls-end', 'controls-finished'];
const KEEP_CONTROLS = new Set(['controls-worst-1650x1080', 'controls-worst-1280x1024', 'controls-worst-1024x768', 'controls-worst-2560x1080', 'controls-worst-1280x720']);

// The way back to following the music with one screen (room-2d.md, "Back to following the
// music"): the rail right after a hand-over and later; their worst cases at every size.
const FOLLOW = ['handover', 'manual-follow'];
const WORST_FOLLOW = ['worst-handover', 'worst-manual-follow'];
const KEEP_FOLLOW = new Set(['worst-handover-1280x1024', 'worst-manual-follow-1024x768', 'worst-manual-follow-1280x1024']);

// The follow-up to the scene (room-2d.md, "The follow-up to the scene"): a position pattern folded
// into the Position metric, the next interval's cue, a score 5.2 minutes ahead, and the playlist
// plate. Each at every size; their worst cases at every size.
const FOLLOWUP = ['pattern', 'pattern-down', 'pattern-next-bar', 'pattern-no-count', 'playlist-not-loaded'];
const WORST_FOLLOWUP = ['worst-pattern', 'worst-pattern-no-tempo', 'worst-pattern-four'];
const KEEP_FOLLOWUP = new Set(['pattern-1920x1080', 'pattern-1680x1050', 'pattern-1280x800', 'pattern-1440x1080', 'pattern-1280x1024', 'pattern-1024x768', 'pattern-down-1920x1080', 'pattern-next-bar-1920x1080', 'pattern-next-bar-1280x1024',
  'pattern-no-count-1920x1080', 'pattern-no-count-1440x1080', 'playlist-not-loaded-1920x1080', 'playlist-not-loaded-1440x1080',
  'worst-pattern-four-1280x1024', 'worst-pattern-four-1650x1080', 'worst-pattern-1650x1080', 'worst-pattern-1280x1024', 'worst-pattern-1024x768', 'worst-pattern-no-tempo-1920x1080', 'worst-pattern-no-tempo-1440x1080']);

const WORST = ['worst-off-list', 'worst-running', 'worst-paused', 'worst-before-start', 'worst-finished', 'worst-ambiguous', 'worst-wide', 'worst-wide-before-start'];

// save: false = checked by measure.js, not kept as a PNG in the repository. motion: 'reduce'
// renders with prefers-reduced-motion.
const room = (state, w, h, save = true, motion = null) => ({
  file: `room-${state}.html`, png: `room-${state}${motion ? '-reduced' : ''}-${w}x${h}.png`, w, h, room: true, save, motion,
});
const KEEP_WORST = new Set(['worst-off-list-1280x1024', 'worst-off-list-1650x1080', 'worst-running-1280x720', 'worst-before-start-1280x1024', 'worst-before-start-1650x1080',
  'worst-ambiguous-1650x1080', 'worst-wide-1650x1080', 'worst-wide-1440x1080', 'worst-wide-1280x1024', 'worst-wide-before-start-1650x1080']);

// The class list (class-list.md): the instructor's own window, read at arm's length (presenter
// checks: contrast, collisions, hue, motion, and data-min-cap in pixels). Window client sizes:
// 1920x1080, 1280x800, and 1000x720, the player's default and the smallest (the presenter's minimum).
const LIST_SIZES = [[1920, 1080], [1280, 800], [1000, 720]];
const LIST_STATES = ['synced', 'syncing', 'first-sync', 'offline', 'waiting', 'expired', 'wiping', 'revoked', 'not-paired', 'pairing-start', 'pairing', 'empty', 'long-list', 'no-match', 'long-titles', 'pinned-newer', 'file-error', 'unavailable', 'not-updated'];
const KEEP_LIST = new Set(['synced-1920x1080', 'synced-1280x800', 'long-list-1000x720', ...LIST_STATES.map((s) => `${s}-1000x720`)]);
const list = (state, w, h) => ({ file: `class-list-${state}.html`, png: `class-list-${state}-${w}x${h}.png`, w, h, room: false, presenter: true, save: KEEP_LIST.has(`${state}-${w}x${h}`) });

// The website pages (site.md): phone, tablet and desktop widths at the page's full height (h is
// worked out by fit.js). Every state is checked at all three; PNGs are kept for phone and
// desktop, and for tablet on the main state of each page. The narrowest supported width, 320,
// is checked (and not kept) for the main states: nothing scrolls sideways.
const { NAMES: SITE_NAMES } = require('./site-pages');
const SITE_WIDTHS = [390, 820, 1280];
const SITE_MAIN = ['sign-in', 'sign-in-sent', 'classes', 'class-detail', 'devices', 'pair-found', 'account-sessions', 'account-passkeys', 'account-data', 'link-source'];
const site = (name, w) => ({
  file: `site-${name}.html`, png: `site-${name}-${w}.png`, w, h: 0, auto: true, room: false, presenter: true, site: true,
  save: w === 390 || w === 1280 || (w === 820 && SITE_MAIN.includes(name)),
});

// The download page (download.md): website checks at the phone and desktop widths (kept) and at 320
// (checked, not kept); download-pages.js writes the files, one per state.
const { NAMES: DL_NAMES } = require('./download-pages');
const dl = (name, w) => ({ file: `download-${name}.html`, png: `download-${name}-${w}.png`, w, h: 0, auto: true, room: false, presenter: true, site: true, save: w !== 320 });

// The handlebar companion (companion.md): every state in portrait and landscape at the reference
// phone (kept) and at the smallest supported size of each orientation (checked; one kept).
const { NAMES: COMPANION_NAMES } = require('./companion-pages');
const COMPANION_SIZES = [[390, 844], [844, 390], [360, 640], [640, 360]];
const companion = (name, w, h) => ({
  file: `companion-${name}.html`, png: `companion-${name}-${w}x${h}.png`, w, h, room: false, companion: true,
  save: (w === 390 && h === 844) || (w === 844 && h === 390) || (name === 'running' && w === 360 && h === 640),
});

// The rider page (rider.md): every state in portrait and landscape at the reference phone (kept)
// and at the smallest supported size of each orientation (checked; one kept). A form state may
// scroll vertically (the keyboard is up) and are checked in portrait only (a landscape phone with the
// keyboard up shows a few lines); every other state fits on the screen.
const { NAMES: RIDER_NAMES, FORMS: RIDER_FORMS } = require('./rider-pages');
const rider = (name, w, h) => ({
  file: `rider-${name}.html`, png: `rider-${name}-${w}x${h}.png`, w, h, room: false, rider: true, form: RIDER_FORMS.includes(name),
  save: (w === 390 && h === 844) || (w === 844 && h === 390) || (name === 'running' && w === 360 && h === 640),
});

// The rider page's sensor states (sensors.md): the same sizes and checks as the rider page. The
// sheets are forms (they may scroll down) and are checked in portrait only.
const { NAMES: SENSOR_NAMES, FORMS: SENSOR_FORMS } = require('./sensors-pages');
const sensorShot = (name, w, h) => ({
  file: `sensors-${name}.html`, png: `sensors-${name}-${w}x${h}.png`, w, h, room: false, rider: true, form: SENSOR_FORMS.includes(name),
  save: (w === 390 && h === 844) || (w === 844 && h === 390),
});

// The presenter's sensor panel and the room screen's sensor strip (sensors.md): the window client
// sizes of presenter.md (1000x720 kept, 1280x800 for the open drawer), the strip at every room size.
const { NAMES: SP_NAMES } = require('./sensors-presenter-pages');
const sensorsPresenter = (name, w, h) => ({
  file: `sensors-presenter-${name}.html`, png: `sensors-presenter-${name}-${w}x${h}.png`, w, h, room: false, presenter: true,
  save: w === 1000 || ['open', 'closed'].includes(name),
});

// The presenter window with the riders panel (riders-panel.md): the window client sizes of
// presenter.md, 1000x720 (the smallest; every state kept) and 1280x800 (the open drawer and the row kept).
const { NAMES: PR_NAMES } = require('./presenter-riders-pages');
const presenterRiders = (name, w, h) => ({
  file: `presenter-riders-${name}.html`, png: `presenter-riders-${name}-${w}x${h}.png`, w, h, room: false, presenter: true,
  save: w === 1000 || ['open', 'closed'].includes(name),
});

// The join sheet (room-join.md): both QR codes on the room screen. Checked at every size; the main
// state and the worst case are kept at the sizes below.
const JOIN = ['join-before-start', 'join-new-code', 'join-running'];
const KEEP_JOIN = new Set(['join-before-start-1440x1080', 'join-worst-1280x1024', 'join-worst-1650x1080', 'join-worst-1280x720']);

// The web player page (play.md): every room state at the four reference sizes (phone and tablet,
// each way up; kept), the main and worst states at the smallest phone each way up (checked; the
// running one kept), and the phone with the browser's bars showing (full screen not available,
// kept). The picker and its states are website pages (site.md's checks) at four widths.
const { NAMES: PLAY_NAMES, SITE_NAMES: PLAY_SITE } = require('./play-pages');
const PLAY_SIZES = [[390, 844], [844, 390], [768, 1024], [1024, 768]];
const PLAY_SMALL = ['before-start', 'running', 'running-band', 'paused', 'end-asked', 'worst', 'worst-band', 'worst-before-start'];
const playRoom = (name, w, h, save = true, motion = null) => ({
  file: `play-${name}.html`, png: `play-${name}${motion ? '-reduced' : ''}-${w}x${h}.png`, w, h, room: false, play: true, save, motion,
});
const playSite = (name, w) => ({
  file: `play-${name}.html`, png: `play-${name}-${w}.png`, w, h: 0, auto: true, room: false, presenter: true, site: true, save: w === 390 || w === 1024,
});

// The Android app's own screens (app.md): every page and class-screen state at the reference
// phone each way up (kept), and at the smallest phone and a tablet each way up (checked). A form
// state is checked in portrait only, as the rider page's. The external display at two room sizes (kept).
const { NAMES: APP_NAMES, FORMS: APP_FORMS, ROOMS: APP_ROOMS, DISPLAYS: APP_DISPLAYS } = require('./app-pages');
const APP_SIZES = [[390, 844], [844, 390], [360, 640], [640, 360], [768, 1024], [1024, 768]];
const appShot = (name, w, h) => ({
  file: `app-${name}.html`, png: `app-${name}-${w}x${h}.png`, w, h, room: false, app: true, appRoom: APP_ROOMS.includes(name),
  display: APP_DISPLAYS.includes(name), form: APP_FORMS.includes(name), save: APP_DISPLAYS.includes(name) || (w === 390 && h === 844) || (w === 844 && h === 390),
});

// Connect Swedebeat and the mix states (swedebeat.md): the class list at its three window sizes
// (1000x720 kept, the main state also at 1920x1080), and the room link line at three room sizes
// (1920x1080 kept, 1024x768 kept for the longest line, 1280x1024 checked).
const { NAMES: SW_NAMES, ROOM_NAMES: SW_ROOMS } = require('./swedebeat-pages');
const swList = (name, w, h) => ({ file: `class-list-swedebeat-${name}.html`, png: `class-list-swedebeat-${name}-${w}x${h}.png`, w, h, room: false, presenter: true, save: w === 1000 || w === 1280 || (name === 'signed-in' && w === 1920) });
const SW_ROOM_SIZES = [[1920, 1080], [1280, 1024], [1024, 768]];

// The instructor's music files state (music-files.md): the class list at its three window sizes
// (1000x720 kept, the main state also at 1280x800), and the presenter window mid-class at its two.
const { NAMES: MF_NAMES, PRES_NAMES: MF_PRES } = require('./music-files-pages');
const mfList = (name, w, h) => ({ file: `class-list-music-files-${name}.html`, png: `class-list-music-files-${name}-${w}x${h}.png`, w, h, room: false, presenter: true, save: w === 1000 || (w === 1280 && ['found', 'missing'].includes(name)) });
const mfPres = (name, w, h) => ({ file: `presenter-music-${name}.html`, png: `presenter-music-${name}-${w}x${h}.png`, w, h, room: false, presenter: true, save: w === 1000 || (w === 1280 && name === 'stopped') });

// The update notice and the "Updates" settings (updates.md): the settings page and the class list
// with the notice, at the class list's three window sizes (1000x720 kept, the main states also at 1920x1080).
const { NAMES: UPD_NAMES, LIST_NAMES: UPD_LISTS } = require('./updates-pages');
const upd = (name, w, h) => ({ file: `updates-${name}.html`, png: `updates-${name}-${w}x${h}.png`, w, h, room: false, presenter: true, save: w === 1000 || (w === 1920 && (name === 'newer' || name === 'list-newer')) });

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const SHOTS = [
  ...STATES.map((s) => room(s, 1920, 1080)),
  room('running', 1280, 720),
  room('running', 1280, 800), // 16:10
  room('ftp-test', 1280, 800),
  room('ftp-test', 1650, 1080),
  room('ftp-test', 1440, 1080),
  room('finished', 1440, 1080),
  room('running', 1440, 1080), // 4:3
  room('paused', 1440, 1080),
  room('last-interval', 1440, 1080),
  room('last-interval', 1280, 1024), // 5:4 with "On the beat"
  room('before-start', 1440, 1080),
  ...MORE.flatMap((s) => [room(s, 1920, 1080), room(s, 1650, 1080, false), room(s, 1280, 1024, false)]),
  room('running', 1920, 1080, true, 'reduce'), // the strict S6 screen is the same with reduced motion on
  ...WORST.flatMap((s) => SIZES.map(([w, h]) => room(s, w, h, KEEP_WORST.has(`${s}-${w}x${h}`)))),
  ...[...FOLLOWUP, ...WORST_FOLLOWUP].flatMap((s) => SIZES.map(([w, h]) => room(s, w, h, KEEP_FOLLOWUP.has(`${s}-${w}x${h}`)))),
  room('pattern', 1920, 1080, true, 'reduce'), // the count steps on its ticks with reduced motion too
  ...CONTROLS.map((s) => room(s, 1920, 1080)),
  ...['starting', 'reconnecting', 'refused', 'unreachable', 'ended'].map((k) => room(`controls-slot-${k}`, 1920, 1080, false)), // the slot's other states
  room('controls-running', 1440, 1080), // 4:3
  room('controls-running', 1920, 1080, true, 'reduce'), // the band appears and fades at once
  ...SIZES.map(([w, h]) => room('controls-worst', w, h, KEEP_CONTROLS.has(`controls-worst-${w}x${h}`))),
  ...FOLLOW.map((s) => room(s, 1920, 1080)),
  ...WORST_FOLLOW.flatMap((s) => SIZES.map(([w, h]) => room(s, w, h, KEEP_FOLLOW.has(`${s}-${w}x${h}`)))),
  room('running', 480, 270), // the room preview inside the presenter window
  room('worst-running', 480, 270, false),
  { file: 'presenter.html', png: 'presenter-1280x800.png', w: 1280, h: 800, room: false, presenter: true, save: true },
  // The player's default presenter window (1000x760 with its title bar).
  { file: 'presenter.html', png: 'presenter-1000x720.png', w: 1000, h: 720, room: false, presenter: true, save: true },
  ...LIST_STATES.flatMap((s) => LIST_SIZES.map(([w, h]) => list(s, w, h))),
  ...SW_NAMES.flatMap((n) => LIST_SIZES.map(([w, h]) => swList(n, w, h))),
  ...SW_ROOMS.flatMap((n) => SW_ROOM_SIZES.map(([w, h]) => room(`mix-${n}`, w, h, true))),
  ...MF_NAMES.flatMap((n) => LIST_SIZES.map(([w, h]) => mfList(n, w, h))),
  ...MF_PRES.flatMap((n) => [[1000, 720], [1280, 800]].map(([w, h]) => mfPres(n, w, h))),
  ...[...UPD_NAMES, ...UPD_LISTS].flatMap((n) => LIST_SIZES.map(([w, h]) => upd(n, w, h))),
  ...SITE_NAMES.flatMap((n) => SITE_WIDTHS.map((w) => site(n, w))),
  ...SITE_MAIN.map((n) => ({ ...site(n, 320), save: false })),
  ...DL_NAMES.flatMap((n) => [320, 390, 1280].map((w) => dl(n, w))),
  ...COMPANION_NAMES.flatMap((n) => COMPANION_SIZES.map(([w, h]) => companion(n, w, h))),
  ...JOIN.map((s) => room(s, 1920, 1080)),
  ...SIZES.filter(([w, h]) => !(w === 1920 && h === 1080)).map(([w, h]) => room('join-before-start', w, h, KEEP_JOIN.has(`join-before-start-${w}x${h}`))),
  ...SIZES.map(([w, h]) => room('join-worst', w, h, KEEP_JOIN.has(`join-worst-${w}x${h}`))),
  ...PR_NAMES.flatMap((n) => [[1000, 720], [1280, 800]].map(([w, h]) => presenterRiders(n, w, h))),
  ...RIDER_NAMES.flatMap((n) => COMPANION_SIZES.filter(([w, h]) => !RIDER_FORMS.includes(n) || h > w).map(([w, h]) => rider(n, w, h))),
  ...SENSOR_NAMES.flatMap((n) => COMPANION_SIZES.filter(([w, h]) => !SENSOR_FORMS.includes(n) || h > w).map(([w, h]) => sensorShot(n, w, h))),
  ...SP_NAMES.flatMap((n) => [[1000, 720], [1280, 800]].map(([w, h]) => sensorsPresenter(n, w, h))),
  room('sensors-strip', 1920, 1080), room('sensors-strip', 1024, 768), room('sensors-strip-missing', 1920, 1080, false),
  ...SIZES.map(([w, h]) => room('sensors-strip-worst', w, h, ['1920x1080', '1024x768'].includes(`${w}x${h}`))),
  ...PLAY_NAMES.flatMap((n) => PLAY_SIZES.map(([w, h]) => playRoom(n, w, h))),
  ...PLAY_SMALL.flatMap((n) => [[360, 640], [640, 360]].map(([w, h]) => playRoom(n, w, h, n === 'running'))),
  playRoom('running', 390, 664), // the browser's bars showing: full screen not available
  playRoom('running-band', 390, 844, false, 'reduce'), // the band appears and goes at once
  ...PLAY_SITE.flatMap((n) => [390, 768, 844, 1024].map((w) => playSite(n, w))),
  ...APP_NAMES.filter((n) => !APP_DISPLAYS.includes(n)).flatMap((n) => APP_SIZES.filter(([w, h]) => !APP_FORMS.includes(n) || h > w).map(([w, h]) => appShot(n, w, h))),
  ...APP_DISPLAYS.flatMap((n) => [[1920, 1080], [1280, 720]].map(([w, h]) => appShot(n, w, h))),
].filter((s) => !ONLY || ONLY.test(s.png));

module.exports = { SHOTS, STATES, MORE, SIZES, WORST, CONTROLS, FOLLOW };

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
  room('running', 1920, 1080, true, 'reduce'), // the beat dot is off with reduced motion
  ...WORST.flatMap((s) => SIZES.map(([w, h]) => room(s, w, h, KEEP_WORST.has(`${s}-${w}x${h}`)))),
  room('running', 480, 270), // the room preview inside the presenter window
  room('worst-running', 480, 270, false),
  { file: 'presenter.html', png: 'presenter-1280x800.png', w: 1280, h: 800, room: false, presenter: true, save: true },
  // The player's default presenter window (1000x760 with its title bar).
  { file: 'presenter.html', png: 'presenter-1000x720.png', w: 1000, h: 720, room: false, presenter: true, save: true },
  ...LIST_STATES.flatMap((s) => LIST_SIZES.map(([w, h]) => list(s, w, h))),
].filter((s) => !ONLY || ONLY.test(s.png));

module.exports = { SHOTS, STATES, MORE, SIZES, WORST };

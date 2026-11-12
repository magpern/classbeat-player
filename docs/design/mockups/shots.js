// Which mock-up is captured and checked at which size. Shared by shoot.js and measure.js.
// ONLY=<regex> limits both to the matching shots.
'use strict';

const STATES = ['before-start', 'running', 'paused', 'coasting', 'off-list', 'ambiguous', 'manual', 'last-interval', 'finished', 'ftp-test'];

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

// The worst case of every text slot (gen: the longest content the format allows).
const WORST = ['worst-off-list', 'worst-running', 'worst-paused', 'worst-before-start', 'worst-finished'];

// save: false = checked by measure.js, not kept as a PNG in the repository.
const room = (state, w, h, save = true) => ({ file: `room-${state}.html`, png: `room-${state}-${w}x${h}.png`, w, h, room: true, save });
const KEEP_WORST = new Set(['worst-off-list-1280x1024', 'worst-off-list-1650x1080', 'worst-running-1280x720', 'worst-before-start-1280x1024', 'worst-before-start-1650x1080']);

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
  ...WORST.flatMap((s) => SIZES.map(([w, h]) => room(s, w, h, KEEP_WORST.has(`${s}-${w}x${h}`)))),
  room('running', 480, 270), // the room preview inside the presenter window
  room('worst-running', 480, 270, false),
  { file: 'presenter.html', png: 'presenter-1280x800.png', w: 1280, h: 800, room: false, presenter: true, save: true },
].filter((s) => !ONLY || ONLY.test(s.png));

module.exports = { SHOTS, STATES, SIZES, WORST };

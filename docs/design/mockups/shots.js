// Which mock-up is captured at which size. Shared by shoot.js and measure.js.
'use strict';
const room = (state, w, h) => ({ file: `room-${state}.html`, png: `room-${state}-${w}x${h}.png`, w, h, room: true });

const STATES = ['before-start', 'running', 'paused', 'coasting', 'off-list', 'ambiguous', 'manual', 'last-interval', 'finished'];

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const SHOTS = [
  ...STATES.map((s) => room(s, 1920, 1080)),
  room('running', 1280, 720),
  room('running', 1440, 1080), // 4:3
  room('paused', 1440, 1080),
  room('last-interval', 1440, 1080),
  room('before-start', 1440, 1080),
  room('running', 480, 270), // the room preview inside the presenter window
  { file: 'presenter.html', png: 'presenter-1280x800.png', w: 1280, h: 800, room: false, presenter: true },
].filter((s) => !ONLY || ONLY.test(s.png));

module.exports = { SHOTS, STATES };

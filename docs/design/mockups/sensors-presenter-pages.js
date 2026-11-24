// The presenter window's sensor panel and the room screen's sensor strip (docs/design/sensors.md).
// `node sensors-presenter-pages.js` writes sensors-presenter-<name>.html and room-sensors-strip*.html
// beside this file. All names and numbers are made up. The window is the presenter's with the riders
// row (presenter-riders-pages.js) and, above it, the sensors row or its drawer.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./presenter-riders-pages');
const { esc, L, M, B, STATUS, NOTICE, NEXTSONG, CONTROLS, row } = R;

const pages = {};
const add = (name, title, comment, side) => { pages[name] = { title, comment, side }; };

// The same gauge as the rider page (gauge_calc): one band width either side of the plan.
function gauge(lo, hi, v, z) {
  const w = Math.max(hi - lo, 0.15 * hi);
  const min = lo - w, span = hi - lo + 2 * w;
  const pct = (x) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
  return `<div class="gauge z${z}" role="meter" aria-label="Reading against the plan"><i class="band" style="left:${pct(lo).toFixed(1)}%;width:${(pct(hi) - pct(lo)).toFixed(1)}%"></i>`
    + `${v == null ? '' : `<i class="mark" style="left:${pct(v).toFixed(1)}%"></i>`}</div>`;
}
// A reading: the number in Big Shoulders at 26 px (cap 18 px) and its unit. null: a dash.
const rd = (v, unit) => `<span class="rd${v == null ? ' none' : ''}"><span class="v n" data-tier="minor" data-min-cap="17.5">${v == null ? '–' : v}</span><span class="u" data-tier="label" data-min-cap="10.5">${esc(unit)}</span></span>`;

// ---------- The sensors row (closed) ----------
// o: tag (state in words), button, line (html under the head).
const srow = (o) => `<div class="sensors-row"><div class="head"><span class="what" data-tier="minor" data-min-cap="11.8">Sensors</span>${o.tag ? L(o.tag, ' class="tag"') : ''}${o.button || ''}</div>${o.line ? `<div class="line">${o.line}</div>` : ''}</div>`;
const SHOW = B('Show', { action: 'sensors_show' });
const closed = (o) => STATUS + NOTICE + NEXTSONG + CONTROLS + srow(o) + row({ count: '12', button: R.B('Show list', { action: 'riders_show' }) });

// ---------- The drawer ----------
// A measure: label, plan, gauge, reading.
const mrow = (label, plan, g, v, unit) => `<div class="mr"><span class="lab">${L(label)}</span><span class="plan">${L(plan)}</span><div class="gl">${g || '<div class="gauge none"></div>'}</div>${rd(v, unit)}</div>`;
const nofield = (label, value) => `<div class="fld"><span>${L(label, '', 2)}</span><span class="box" data-tier="minor" data-min-cap="11.8">${esc(value)}</span></div>`;
const dev = (name, state, lost, action = 'Disconnect') => `<li class="dev${lost ? ' lost' : ''}"><div class="who"><span data-tier="minor" data-min-cap="11.8" data-lines="2" data-clamp="2">${esc(name)}</span><span class="st">${L(state)}</span></div>${B(action, { action: action === 'Connect' ? 'sensor_pick' : action === 'Reconnect' ? 'sensor_reconnect' : 'sensor_disconnect' })}</li>`;
// o: head tag, fixed (readings html), room (the room-screen switch, one display only), list (items), note.
const drawer = (o) => `<section class="drawer sensors"><div class="head"><span class="what" data-tier="minor" data-min-cap="11.8">Sensors</span>${o.tag ? L(o.tag, ' class="tag"') : ''}${B('Hide', { action: 'sensors_hide' })}</div>`
  + (o.fixed ? `<div class="reads">${o.fixed}</div>` : '') + (o.room || '')
  + `<ul class="names" data-scroll>${o.list}</ul></section>`;
const ROOM = (on) => `<div class="roomsw">${B('Show on the room screen', { action: 'room_strip', cls: 'sw' + (on ? ' on' : ''), sub: on ? 'On. Covers the score. S turns it off' : 'Off. S turns it on' })}</div>`;
const NOTE = '<li class="note">' + L('Readings stay on this computer. Nothing is sent, saved or compared.', '', 2) + '</li>';
const NUMS = `<li class="nums">${nofield('Your FTP, in watts', '250')}${nofield('Your max heart rate, in bpm', '185')}</li>`;
const open = (o, notice = true) => STATUS + (notice ? NOTICE : '') + drawer(o) + row({ count: '12', button: R.B('Show list', { action: 'riders_show' }) });

const READ3 = mrow('Heart rate', 'Plan 157–170 bpm', gauge(157, 170, 142, 4), 142, 'bpm') + mrow('Power', 'Plan 220–235 W', gauge(220, 235, 238, 4), 238, 'W') + mrow('Cadence', 'No plan', '', 92, 'rpm');
const DEVS = dev('Polar H10 A1B2C3', 'Heart rate, connected') + dev('Wahoo KICKR 4F2E', 'Power and cadence, connected');

add('unavailable', 'Presenter: sensors unavailable', 'State: the stand-in source (ADR 0012 section 6): reading sensors on this computer is not set up. The row says so in words; it has no button and no drawer. This is the state the player ships in until the owner decides.',
  closed({ tag: 'Not available yet', line: L('Reading sensors on this computer is not set up yet.', '', 2) }));
add('idle', 'Presenter: sensors, nothing connected', 'State: sensors available (SensorSource idle), nothing connected. The row offers Connect a sensor.',
  closed({ button: B('Connect a sensor', { action: 'sensor_connect' }), line: L('Nothing connected') }));
add('closed', 'Presenter: sensors row', 'State: a strap and a bike connected. The row shows the live numbers, in white, in the order heart rate, power, cadence. Show opens the drawer.',
  closed({ tag: 'Connected', button: SHOW, line: rd(142, 'bpm') + rd(238, 'W') + rd(92, 'rpm') }));
add('closed-lost', 'Presenter: sensors row, lost', 'State: the strap dropped. Its reading goes to a dash at once (a reading is held 3 s at most); the state says so in words.',
  closed({ tag: 'Sensor lost', button: SHOW, line: rd(null, 'bpm') + rd(238, 'W') + rd(92, 'rpm') }));
add('open', 'Presenter: sensors drawer', 'State: the drawer open, two sensors connected, two displays (no room-screen switch). Readings with their plan and a gauge never scroll; the devices, the instructor’s own numbers and the note scroll inside the drawer. The riders row stays at the foot.',
  open({ tag: 'Connected', fixed: READ3, list: DEVS + B('Connect another sensor', { action: 'sensor_connect' }).replace(/^(.*)$/, '<li class="act">$1</li>') + NUMS + NOTE }));
add('open-one-display', 'Presenter: sensors drawer, one display', 'State: as open, with one display. The room-screen switch is offered (off by default): turning it on shows the readings on the room screen over the score (the S key does the same).',
  open({ tag: 'Connected', fixed: READ3, room: ROOM(false), list: DEVS + NUMS + NOTE }));
add('open-one-display-on', 'Presenter: sensors drawer, on the room screen', 'State: one display, the switch on. The state says what it covers and which key turns it off.',
  open({ tag: 'Connected', fixed: READ3, room: ROOM(true), list: DEVS + NUMS + NOTE }));
add('open-missing', 'Presenter: sensors drawer, no reading', 'State: the strap is connected but sent no value for 3 s: a dash and no tick, never the last number.',
  open({ tag: 'Connected', fixed: mrow('Heart rate', 'Plan 157–170 bpm', gauge(157, 170, null, 4), null, 'bpm') + mrow('Power', 'Plan 220–235 W', gauge(220, 235, 238, 4), 238, 'W') + mrow('Cadence', 'No plan', '', 92, 'rpm'),
    list: dev('Polar H10 A1B2C3', 'Heart rate, no reading') + dev('Wahoo KICKR 4F2E', 'Power and cadence, connected') + NUMS + NOTE }));
add('open-lost', 'Presenter: sensors drawer, one lost', 'State: the strap is lost: a dashed marker and the words say so, and its row offers Reconnect (a press; nothing retries by itself).',
  open({ tag: 'Sensor lost', fixed: mrow('Heart rate', 'Plan 157–170 bpm', gauge(157, 170, null, 4), null, 'bpm') + mrow('Power', 'Plan 220–235 W', gauge(220, 235, 238, 4), 238, 'W') + mrow('Cadence', 'No plan', '', 92, 'rpm'),
    list: dev('Polar H10 A1B2C3', 'Heart rate, lost', true, 'Reconnect') + dev('Wahoo KICKR 4F2E', 'Power and cadence, connected') + NUMS + NOTE }));
add('no-numbers', 'Presenter: sensors drawer, no FTP', 'State: the instructor has typed no FTP and no max heart rate. The plan is in percentages, so the readings are numbers with no gauge, and a line says where to type them.',
  open({ tag: 'Connected', fixed: mrow('Heart rate', 'Plan 85–92% max', '', 142, 'bpm') + mrow('Power', 'Plan 88–94% FTP', '', 238, 'W') + mrow('Cadence', 'No plan', '', 92, 'rpm'),
    list: `<li class="note">${L('Type your FTP and max heart rate below to see the gauge.', '', 2)}</li>` + DEVS + `<li class="nums">${nofield('Your FTP, in watts', '')}${nofield('Your max heart rate, in bpm', '')}</li>` + NOTE }));
add('choosing', 'Presenter: choosing a sensor', 'State: Connect a sensor pressed. The app’s own list of nearby devices (ADR 0012 section 6): the names the devices give, each with Connect, and Cancel. Only devices that offer a heart rate, cycling power, cycling speed and cadence or fitness machine service are listed.',
  open({ tag: 'Choosing', list: `<li class="note">${L('Looking for sensors. Wake yours.', '', 2)}</li>` + dev('Polar H10 A1B2C3', 'Heart rate', false, 'Connect') + dev('Wahoo KICKR 4F2E', 'Power and cadence', false, 'Connect')
    + `<li class="act">${B('Cancel', { action: 'sensor_cancel' })}</li>` }));
add('failed', 'Presenter: could not connect', 'State: the chosen device would not connect. One line in words, the list stays, nothing else changes.',
  open({ tag: 'Could not connect', list: `<li class="note">${L('Could not connect to Polar H10 A1B2C3. Check that it is awake.', '', 2)}</li>` + dev('Polar H10 A1B2C3', 'Heart rate', false, 'Connect') + dev('Wahoo KICKR 4F2E', 'Power and cadence', false, 'Connect')
    + `<li class="act">${B('Cancel', { action: 'sensor_cancel' })}</li>` }));
add('worst', 'Presenter: sensors, worst case', 'Worst case: four-digit power (1999 W) against a three-digit plan, three-digit heart rate and cadence, a 32-character device name, five devices.',
  open({ tag: 'Connected', fixed: mrow('Heart rate', 'Plan 184–230 bpm', gauge(184, 230, 188, 7), 188, 'bpm') + mrow('Power', 'Plan 675–900 W', gauge(675, 900, 1999, 7), 1999, 'W') + mrow('Cadence', 'No plan', '', 188, 'rpm'),
    room: ROOM(true), list: dev('WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', 'Power and cadence, connected') + dev('Polar H10 A1B2C3', 'Heart rate, lost', true, 'Reconnect') + dev('Garmin HRM-Pro 0042', 'Heart rate, connected') + NUMS + NOTE }));

const NAMES = Object.keys(pages);
const doc = (n) => {
  const { title, comment, side } = pages[n];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="presenter-riders.css">
<link rel="stylesheet" href="sensors-presenter.css">
</head>
<body>
<!-- ${comment}  Spec: docs/design/sensors.md. Generated by sensors-presenter-pages.js: edit that, not this file. -->
<main>
  <h2 data-tier="label" data-min-cap="10.5">Room screen</h2>
  <div class="preview"><iframe src="room-running.html" title="Room screen preview" tabindex="-1"></iframe></div>
  <p class="cue" data-tier="minor" data-min-cap="11.8" data-lines="2">Find the beat and hold it. Breathe out on every second bar.</p>
</main>
<aside class="side">
${side}
</aside>
</body>
</html>
`;
};

// ---------- The room screen's strip (one display, off by default) ----------
// The running room screen with the score's box taken by the strip. cells: [label, plan, gauge, reading].
const cell = (label, plan, g, v, unit) => `<div class="cell"><span class="tx"><span class="lbl" data-tier="label">${esc(label)}</span><span class="lbl pl" data-tier="label">${esc(plan)}</span></span>`
  + `<span class="rv${v == null ? ' none' : ''}"><span class="v n" data-tier="value">${v == null ? '–' : v}</span><span class="u" data-tier="minor">${esc(unit)}</span></span>${g}</div>`;
function room(cells, comment, title) {
  const base = fs.readFileSync(path.join(__dirname, 'room-running.html'), 'utf8')
    .replace('<link rel="stylesheet" href="room.css">', '<link rel="stylesheet" href="room.css">\n<link rel="stylesheet" href="sensors-room.css">')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body>', '<body class="strip">')
    .replace(/<!-- State: running[^>]*-->/, `<!-- ${comment}  Spec: docs/design/sensors.md. Generated by sensors-presenter-pages.js: edit that, not this file. -->`);
  return base.replace('</body>', `<section class="sstrip" aria-label="Your sensors">${cells.join('')}</section>\n</body>`);
}
const RG = (lo, hi, v) => gauge(lo, hi, v, 4);
const ROOMS = {
  'sensors-strip': [[cell('Heart rate', 'Plan 157–170', RG(157, 170, 142), 142, 'bpm'), cell('Power', 'Plan 220–235', RG(220, 235, 238), 238, 'W'), cell('Cadence', 'No plan', '<div class="gauge none"></div>', 92, 'rpm')],
    'State: one display, the instructor turned the strip on (S, or the switch in the presenter’s sensors drawer). It lies exactly over the score’s box and covers nothing else; the band, when shown, covers it as it covers the score. Off by default. Never shows a rider’s reading.', 'Room screen: your sensors'],
  'sensors-strip-missing': [[cell('Heart rate', 'Plan 157–170', RG(157, 170, null), null, 'bpm'), cell('Power', 'Plan 220–235', RG(220, 235, 238), 238, 'W'), cell('Cadence', 'No plan', '<div class="gauge none"></div>', 92, 'rpm')],
    'State: the strap sent no value for 3 s: a dash and no tick; the unit stays.', 'Room screen: your sensors, no reading'],
  'sensors-strip-worst': [[cell('Heart rate', 'Plan 184–230', RG(184, 230, 188), 188, 'bpm'), cell('Power', 'Plan 675–900', RG(675, 900, 1999), 1999, 'W'), cell('Cadence', 'No plan', '<div class="gauge none"></div>', 188, 'rpm')],
    'Worst case: four-digit power against a three-digit plan, three-digit heart rate and cadence.', 'Room screen: your sensors, worst case'],
};
const ROOM_NAMES = Object.keys(ROOMS);
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `sensors-presenter-${n}.html`), doc(n));
  for (const n of ROOM_NAMES) fs.writeFileSync(path.join(__dirname, `room-${n}.html`), room(...ROOMS[n]));
  console.log(`${NAMES.length + ROOM_NAMES.length} mock-ups written`);
}
module.exports = { NAMES, ROOM_NAMES };

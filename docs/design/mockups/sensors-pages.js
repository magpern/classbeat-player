// The rider page's sensor mock-ups (docs/design/sensors.md), one entry per state.
// `node sensors-pages.js` writes sensors-<name>.html beside this file. All device names, numbers
// and readings are made up. Built on the rider page's kit (rider-kit.js): the same gel, clock,
// next rows and keys, plus the readings block and the sensors sheet.
'use strict';
const fs = require('fs');
const path = require('path');
const K = require('./rider-kit');
const { esc, T, gel, coming, key, top, clock, effort, run, page, h1, p } = K;

const pages = {};
const add = (name, title, comment, body) => { pages[name] = { title, comment, body }; };

// The gauge (gauge_calc, docs/design/sensors.md "The gauge"): the track runs from one band width
// below the planned range to one band width above it (the band is at least 15 % of its top end
// wide), the tick is clamped to the track. lo, hi: the planned range in the reading's own unit.
function gauge(lo, hi, v, z) {
  const w = Math.max(hi - lo, 0.15 * hi);
  const min = lo - w, span = hi - lo + 2 * w;
  const pct = (x) => Math.max(0, Math.min(100, ((x - min) / span) * 100));
  const mark = v == null ? '' : `<i class="mark" style="left:${pct(v).toFixed(1)}%"></i>`;
  return `<div class="gauge z${z}" role="meter" aria-label="Reading against the plan"><i class="band" style="left:${pct(lo).toFixed(1)}%;width:${(pct(hi) - pct(lo)).toFixed(1)}%"></i>${mark}</div>`;
}

// One measure. o: plan [value, unit], read (number, null = no value, undefined = no sensor),
// unit, g [lo, hi] (gauge, only where the plan is in the reading's unit), zone.
function measure(label, o) {
  const plan = o.plan ? `<div class="ev"><span class="n" data-tier="value">${esc(o.plan[0])}</span>${o.plan[1] ? `<span class="u" data-tier="minor">${esc(o.plan[1])}</span>` : ''}</div>` : '<div class="ev"></div>';
  const has = o.read !== undefined;
  const g = has && o.g ? gauge(o.g[0], o.g[1], o.read, o.zone) : (has && o.plan ? '<div class="gauge none"></div>' : '');
  const rd = has ? `<div class="rd${o.read == null ? ' none' : ''}${o.plan ? '' : ' solo'}"><span class="n" data-tier="read">${o.read == null ? '–' : o.read}</span><span class="u" data-tier="minor">${esc(o.unit)}</span></div>` : '';
  return `<div class="m">${T('label', label, 1, ' class="lbl"')}${plan}${g}${rd}</div>`;
}
// The block: columns "Plan" and "Now" are named by the first row's labels in the mock-up text, never
// by colour; the units sit with the numbers.
const block = (ms, extra = '') => `<section class="effort sens">${ms.join('')}${extra}</section>`;
const hint = (t) => T('label', t, 3, ' class="hint"');
const splate = (h, dt) => `<div class="splate" role="alert">${T('minor', h, 1, ' class="h"')}${dt ? T('label', dt, 3, ' class="dt"') : ''}</div>`;

const ME = 'Joined as Anna';
const NEXT3 = [[2, 'Endurance', '0:45'], [5, 'VO2 max', '3:00'], [3, 'Tempo', '2:00']];
const keys2 = (second) => `<nav class="keys two" aria-label="Your numbers and sensors">${key('my_numbers', 'My numbers')}${second}</nav>`;
const CONNECT = key('sensors', 'Connect a sensor');
const SENSORS = key('sensors', 'Sensors');
// Fitting steps (sensors.md, "Fitting"): when the readings, a plate or a hint leave too little height,
// the next rows give way, three then two then one, per orientation. fit: { L: rows kept in landscape, P: rows kept in portrait under 700 px high }.
const fitComing = (rows, fit = {}) => coming(rows).replace('class="coming"', `class="coming${fit.L ? ' fit-L' + fit.L : ''}${fit.P ? ' fit-P' + fit.P : ''}"`);
const view = (eff, k, fit) => run(top(ME, '', '23:41') + gel(4, 'Threshold') + clock('1:10', 'Seated') + eff + fitComing(NEXT3, fit) + k);

// Zone 4 as in rider.md: 88 to 94 % FTP (250 W: 220 to 235), 85 to 92 % of max heart rate (185: 157 to 170).
const PWR = { plan: ['220–235', 'W'], unit: 'W', g: [220, 235], zone: 4 };
const HRT = { plan: ['157–170', 'bpm'], unit: 'bpm', g: [157, 170], zone: 4 };
const RPE = `<div class="m">${T('label', 'RPE', 1, ' class="lbl"')}<div class="ev"><span class="n" data-tier="value">7–8</span></div></div>`;
const PLAN_ONLY = effort([['Power', '220–235', 'W'], ['Heart rate', '157–170', 'bpm'], ['RPE', '7–8', '']]);

add('idle', 'Rider: sensors, not connected', 'State: no sensor connected (SensorSource idle). The class view is as before; the foot row has two keys, My numbers and Connect a sensor. Nothing else changes.',
  view(PLAN_ONLY, keys2(CONNECT)));

add('choosing', 'Rider: sensors, choosing', 'State: Connect a sensor was pressed and the browser shows its own list of devices (the page cannot draw it). The page says what to do and the key is off; closing the list returns to idle without a message.',
  view(block([measure('Power', { ...PWR, read: undefined }), measure('Heart rate', { ...HRT, read: undefined }), RPE], splate('Choose your sensor', 'Pick it in your browser’s list.')),
    keys2(key('sensors', 'Choosing…', { dis: true })), { L: 2 }));

add('heart', 'Rider: heart rate strap connected', 'State: a heart rate strap is connected (SensorSource connected). The heart rate row shows the reading and a gauge against the rider’s own plan (157 to 170 bpm); power has no sensor and keeps only its plan. Colour stays the zone: the band is zone 4’s, the tick is white.',
  view(block([measure('Power', { ...PWR, read: undefined }), measure('Heart rate', { ...HRT, read: 142 }), RPE]), keys2(SENSORS)));

add('both', 'Rider: strap and bike connected', 'State: a heart rate strap and a bike (power and cadence) are connected at once. Power 238 W is just above its band, heart rate 163 bpm is inside its band, and the tick is white in both: nothing says which is right. Cadence has no plan in rider_state, so it is a number only.',
  view(block([measure('Power', { ...PWR, read: 238 }), measure('Heart rate', { ...HRT, read: 163 }), measure('Cadence', { unit: 'rpm', read: 92 }), RPE]), keys2(SENSORS), { P: 2 }));

add('no-numbers', 'Rider: bike connected, no FTP', 'State: a bike is connected but the rider gave no FTP and no max heart rate. The plan is in percentages, so the units differ: the reading is a number with no gauge, and a line says where to add the numbers.',
  view(block([measure('Power', { plan: ['88–94%', 'FTP'], unit: 'W', read: 238 }), measure('Heart rate', { plan: ['85–92%', 'max'], unit: 'bpm', read: undefined }), measure('Cadence', { unit: 'rpm', read: 92 }), RPE],
    hint('Add your FTP in My numbers to see the gauge.')), keys2(SENSORS), { L: 1 }));

add('missing', 'Rider: no reading', 'State: connected, but no value for 3 s (a strap off the skin, a bike not pedalled). The reading shows a dash, never the last number, the tick is gone and a line says which sensor.',
  view(block([measure('Power', { ...PWR, read: undefined }), measure('Heart rate', { ...HRT, read: null }), RPE], hint('No heart rate from your strap.')), keys2(SENSORS)));

add('lost', 'Rider: sensor lost', 'State: the sensor’s connection dropped (SensorSource lost). Readings go to dashes, a plate names the device and the second key becomes Reconnect (a tap; the page does not retry by itself).',
  view(block([measure('Power', { ...PWR, read: undefined }), measure('Heart rate', { ...HRT, read: null }), RPE], splate('Sensor lost', 'Polar H10 A1B2C3. Wake it, then press Reconnect.')),
    keys2(key('reconnect_sensor', 'Reconnect')), { L: 1 }));

add('failed', 'Rider: could not connect', 'State: the rider picked a device and connecting failed (Bluetooth off, device asleep, permission refused). One plate; the key is Connect a sensor again. Closing the list without picking is not a failure and shows nothing.',
  view(block([measure('Power', { ...PWR, read: undefined }), measure('Heart rate', { ...HRT, read: undefined }), RPE], splate('Could not connect', 'Check that Bluetooth is on and the sensor is awake.')),
    keys2(CONNECT), { L: 1 }));

// ---------- The sensors sheet (the second key) ----------
const dev = (name, state, lost) => `<div class="dev${lost ? ' lost' : ''}"><div class="who">${T('minor', name, 2, ' data-clamp="2"')}${T('label', state, 3, ' class="st"')}</div>${key('disconnect_sensor', 'Disconnect')}</div>`;
const SHEET_NOTE = p('Readings stay on this phone. Nothing is sent, saved or compared.', true);
add('sheet', 'Rider: sensors sheet', 'State: the Sensors key was pressed with two sensors connected. Each device with its state in words and Disconnect; Connect another sensor; Done. The class view goes on underneath.',
  page(h1('Sensors') + SHEET_NOTE,
    `<div class="devs">${dev('Polar H10 A1B2C3', 'Heart rate, connected')}${dev('Wahoo KICKR 4F2E', 'Power and cadence, connected')}</div>`
    + `${key('sensors_add', 'Connect another sensor')}${key('done', 'Done', { main: true })}`, 'form'));

add('sheet-lost', 'Rider: sensors sheet, one lost', 'State: the sheet with one sensor lost: the state word and a dashed marker say so, and the row offers Reconnect in place of Disconnect.',
  page(h1('Sensors') + SHEET_NOTE,
    `<div class="devs">${dev('Polar H10 A1B2C3', 'Heart rate, lost', true).replace('Disconnect', 'Reconnect').replace('disconnect_sensor', 'reconnect_sensor')}${dev('Wahoo KICKR 4F2E', 'Power and cadence, connected')}</div>`
    + `${key('sensors_add', 'Connect another sensor')}${key('done', 'Done', { main: true })}`, 'form'));

add('unsupported', 'Rider: no Web Bluetooth', 'State: the browser has no Web Bluetooth (Safari, Firefox, most desktop browsers). The Connect a sensor key opens this sheet: it says so and names what works.',
  page(h1('This browser cannot connect to a sensor') + p('Open this page in Chrome on an Android phone.') + SHEET_NOTE,
    `<div class="duo solo">${key('done', 'Done', { main: true })}</div>`, 'form'));

add('unsupported-iphone', 'Rider: no Web Bluetooth, iPhone', 'State: an iPhone or iPad without Web Bluetooth. The same sheet names Bluefy, the browser that has it.',
  page(h1('This browser cannot connect to a sensor') + p('On an iPhone, open this page in Bluefy.') + SHEET_NOTE,
    `<div class="duo solo">${key('done', 'Done', { main: true })}</div>`, 'form'));

// ---------- Worst case ----------
const NAME80 = 'Maximal aerobic power with standing efforts and short seated recoveries between';
add('worst', 'Rider: sensors, worst case', 'Worst case: four-digit power (1999 W) with a three-digit plan (675 to 900 W, FTP 600 at 150 %), three-digit heart rate and cadence, the 80-character zone name, 58:58 and the longest hint.',
  run(top('Joined as WWWWWWWWWWWWWWWWWWWWWWWW', '', '1:58:58') + gel(7, NAME80, [], { label: 'FTP test, 20 min' }) + clock('58:58', 'Standing')
    + block([measure('Power', { plan: ['675–900', 'W'], unit: 'W', g: [675, 900], zone: 7, read: 1999 }), measure('Heart rate', { plan: ['184–230', 'bpm'], unit: 'bpm', g: [184, 230], zone: 7, read: 188 }),
      measure('Cadence', { unit: 'rpm', read: 188 }), RPE]) + fitComing([[6, NAME80, '20:00'], [7, NAME80, '20:00'], [3, NAME80, '20:00']], { P: 1 }) + keys2(SENSORS)));
add('worst-sheet', 'Rider: sensors sheet, worst case', 'Worst case: a 32-character device name, three devices, the longest state words.',
  page(h1('Sensors') + SHEET_NOTE,
    `<div class="devs">${dev('WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', 'Power and cadence, connected')}${dev('Polar H10 A1B2C3', 'Heart rate, lost', true).replace('Disconnect', 'Reconnect').replace('disconnect_sensor', 'reconnect_sensor')}${dev('Garmin HRM-Pro 0042', 'Heart rate, connected')}</div>`
    + `${key('sensors_add', 'Connect another sensor')}${key('done', 'Done', { main: true })}`, 'form'));

const NAMES = Object.keys(pages);
// The sheets scroll vertically (as My numbers does); every other state fits the screen.
const FORMS = ['sheet', 'sheet-lost', 'unsupported', 'unsupported-iphone', 'worst-sheet'];
function doc({ title, comment, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="companion.css">
<link rel="stylesheet" href="rider.css">
<link rel="stylesheet" href="sensors.css">
</head>
<body>
<!-- ${comment}  Spec: docs/design/sensors.md. Generated by sensors-pages.js: edit that, not this file. -->
${body}
</body>
</html>
`;
}
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `sensors-${n}.html`), doc(pages[n]));
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES, FORMS, pages };

// The room screen's join sheet mock-ups (docs/design/room-join.md). `node room-join-pages.js`
// writes room-join-<name>.html beside this file. Made-up code and address. The QR images are the
// placeholder of the existing room mock-ups: 29 modules and a 4-module quiet zone, not a real code.
'use strict';
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const T = (tier, text, extra = '', lines = 1) => `<span data-tier="${tier}" data-lines="${lines}"${extra}>${esc(text)}</span>`;

const GEL_FIRST = ''; // the sheet covers the stage: no gel before the start
const RAIL_BEFORE = `<header class="rail"><span class="lbl seg"></span><span class="link" data-tier="label">Waiting for the first song</span></header>`;
const d = (s) => s.split('').map((c) => (/\d/.test(c) ? `<span class="d">${c}</span>` : c)).join('');
const RAIL_RUN = `<header class="rail"><span class="val" data-tier="minor">${d('23:41')}</span><span class="lbl" data-tier="label">left</span>`
  + `<span class="val" data-tier="minor">${d('18:19')}</span><span class="lbl" data-tier="label">done</span>`
  + `<span class="lbl seg" data-tier="label" data-clamp="1">Main set</span><span class="link" data-tier="label">Following Spotify</span></header>`;

// The band: the transport, the slot (state line only while the sheet shows both codes: the codes
// are on the sheet, so the slot does not draw a second riders' QR code), End.
const band = (o) => `<nav class="controls" aria-label="Class controls"><div class="transport"><button class="btn"><span class="w" data-tier="label">Previous</span><span class="sub" data-tier="label">${o.prevSub}</span></button>`
  + `<button class="btn main"><span class="w" data-tier="label">${o.main}</span></button><button class="btn"><span class="w" data-tier="label">Next</span><span class="sub" data-tier="label">${o.nextSub}</span></button></div>`
  + `<div class="code"><div class="code-t"><span class="lbl" data-tier="label">Class code</span><span class="v n" data-tier="minor">KXPD-RMTB</span><span class="dt" data-tier="label">${o.state}</span></div></div>`
  + `<button class="btn quit"><span class="w" data-tier="label">End</span></button></nav>`;
const BAND_BEFORE = band({ prevSub: 'Interval', main: 'Start', nextSub: 'Interval', state: 'J hides the codes' });
const BAND_RUN = band({ prevSub: 'Stops following', main: 'Pause', nextSub: 'Song', state: 'J hides the codes' });

// The sheet. o.addr: the address as text; o.plate: the new-code plate.
function sheet(o = {}) {
  const addr = o.addr || 'classbeat.example/j';
  return `<section class="join" aria-label="Join codes">
  <div class="card riders">
    <img class="qr-riders" src="qr-placeholder.svg" alt="QR code to join as a rider: https://classbeat.example/j#KXPD-RMTB">
    <div class="body">
      <h1 data-tier="value">Join the class</h1>
      ${o.plate ? `<span class="plate-new" data-tier="label" role="status">${esc(o.plate)}</span>` : ''}
      <p class="how">${T('minor', 'Scan with your phone’s camera.', '', 2)}</p>
      <div><span class="lbl" data-tier="label">Class code</span><span class="code-big n" data-tier="value">KXPD-RMTB</span></div>
      <div><span class="lbl" data-tier="label">Or open</span><span class="addr" data-tier="minor" data-lines="3">${esc(addr)}</span></div>
    </div>
  </div>
  <div class="card instr">
    <img class="qr-instr" src="qr-placeholder.svg" alt="QR code for the instructor: https://classbeat.example/control#KXPD-RMTB">
    <div class="itext"><h2 data-tier="minor" data-lines="2">Instructor’s phone</h2>
    <span class="lbl" data-tier="label" data-lines="4">Scan, sign in and steer. It gives no control without your sign-in.</span></div>
  </div>
</section>`;
}

const pages = {};
const add = (name, title, comment, body) => { pages[name] = { title, comment, body }; };

add('before-start', 'Room screen: join sheet, before the start',
  'State: before the start, one display, phone remote on. The join sheet shows by itself, over the stage above the band; the band stays (Start always in sight). Riders\' code left, the instructor\'s right. Nothing about riders.',
  RAIL_BEFORE + sheet() + BAND_BEFORE);
add('new-code', 'Room screen: join sheet, new code',
  'State: join_code arrived (the instructor made a new code). Both codes and the text are the new ones at once; the white plate says so for 10 s. The old code is gone from the screen.',
  RAIL_BEFORE + sheet({ plate: 'New code' }) + BAND_BEFORE);
add('running', 'Room screen: join sheet, during the class',
  'State: running; the instructor pressed J. The sheet lies over the stage for at most 20 s and the clock goes on underneath; the rail keeps the class time and the link.',
  RAIL_RUN + sheet() + BAND_RUN);
add('worst', 'Room screen: join sheet, worst case',
  'Worst case: a 60-character site address (it breaks anywhere rather than being cut) and the new-code plate.',
  RAIL_BEFORE + sheet({ addr: 'classbeat-studio-network.internal.example.org/j', plate: 'New code' }) + BAND_BEFORE);

const NAMES = Object.keys(pages);
const html = (n) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(pages[n].title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="room.css">
<link rel="stylesheet" href="controls.css">
<link rel="stylesheet" href="join.css">
</head>
<body class="shown">
<!-- ${pages[n].comment}  Spec: docs/design/room-join.md. Generated by room-join-pages.js: edit that, not this file. -->
${GEL_FIRST}${pages[n].body}
</body>
</html>
`;
if (require.main === module) {
  for (const n of NAMES) fs.writeFileSync(path.join(__dirname, `room-join-${n}.html`), html(n));
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES };

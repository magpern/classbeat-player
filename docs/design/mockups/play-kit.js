// Building blocks of the web player page mock-ups (docs/design/play.md). Pure string functions:
// no I/O. The room screen parts use the markup of the room mock-ups (room.css, controls.css), and
// play.css lays them out again for phone and portrait sizes. Every piece of text is a leaf with
// data-tier, so measure.js checks it. Every control carries data-action (play-checks.js).
'use strict';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A running number: each digit in its cell (system.md, Type).
const digits = (s) => esc(s).replace(/\d/g, (d) => `<span class="d">${d}</span>`);

// The gel. o.down: lights down (paused, before the start); o.label: "Zone" or "First zone";
// o.blank: the house lights up ("Class Complete"). A name over 12 characters takes two lines, over
// 20 (or with a word over 11) it steps down (room-2d.md, "Fitting text"); the product measures.
function gel(z, name, targets, o = {}) {
  if (o.blank) {
    return `<aside class="gel blank"><div class="gel-head"><span class="lbl" data-tier="label">Class</span></div>`
      + `<span class="gel-name n" data-tier="value">Complete</span><div class="gel-targets" data-tier="minor"><span>${esc(o.length)}</span></div></aside>`;
  }
  const long = name.length > 20 || name.split(' ').some((w) => w.length > 11);
  const two = !long && name.length > 12;
  const cls = ['gel-name', 'n', long && 'long', two && 'two'].filter(Boolean).join(' ');
  return `<aside class="gel z${z}${o.down ? ' down' : ''}${targets.length >= 3 ? ' t3' : ''}">`
    + `<div class="gel-head"><span class="gel-num n" data-tier="gel">${z}</span><span class="lbl" data-tier="label" data-lines="2">${esc(o.label || 'Zone')}</span></div>`
    + `<span class="${cls}" data-tier="value" data-lines="${long ? 3 : 2}"${long ? ' data-clamp="3"' : ''}>${esc(name)}</span>`
    + `<div class="gel-targets" data-tier="minor" data-lines="3">${targets.map((t) => `<span>${esc(t)}</span>`).join('')}</div></aside>`;
}

// The rail: class time left and done (portrait shows only "left"), the segment, and the link state. On this page the clock is
// always the manual clock; link: { text, kind } where kind is 'manual' (grey, square) or
// 'manual handover' (white, square: news the instructor can act on).
function rail(left, done, seg, link) {
  const t = left ? `<span class="val" data-tier="minor">${digits(left)}</span><span class="lbl" data-tier="label">left</span>`
    + `<span class="val done" data-tier="minor">${digits(done)}</span><span class="lbl done" data-tier="label">done</span>` : '';
  return `<header class="rail">${t}<span class="lbl seg"${seg ? ' data-tier="label" data-clamp="1"' : ''}>${esc(seg || '')}</span>`
    + `<span class="link ${link.kind || 'manual'}" data-tier="label">${esc(link.text)}</span></header>`;
}

// The clock: label (or the "Paused" plate), the countdown, and the line under it. o.mmss: the
// interval's format is MM:SS (the countdown is sized for it); o.line: the pause line.
function clock(time, o = {}) {
  const lbl = o.pill ? `<span class="lbl"><span class="pill" data-tier="label">Paused</span></span>` : `<span class="lbl" data-tier="label">${esc(o.label || 'Interval left')}</span>`;
  return `<section class="clock">${lbl}<div class="count n${o.mmss ? ' mmss' : ''}" data-tier="hero">${digits(time)}</div>`
    + `${o.line ? `<div class="bars" data-tier="minor" data-lines="2">${esc(o.line)}</div>` : ''}</section>`;
}

// Cadence, position and the song's BPM. No beat dot: the page has only the manual clock.
function metrics(cad, pos, bpm) {
  const v = (lbl, val, unit) => `<div class="metric"><span class="lbl" data-tier="label">${esc(lbl)}</span><span class="v n" data-tier="value">${esc(val)}${unit ? `<small data-tier="minor">${unit}</small>` : ''}</span></div>`;
  const cadence = /^\d/.test(cad) ? v('Cadence', cad, 'rpm') : v('Cadence', cad);
  return `<section class="metrics">${cadence}${v('Position', pos)}${v('Song', bpm, 'bpm')}</section>`;
}

const cue = (text) => `<p class="cue${text.length > 60 ? ' long' : ''}" data-tier="text" data-lines="8">${esc(text)}</p>`;

// The next row. cadence and position sit in .more, which drops to a second line in portrait.
function next(z, name, len, cad, pos) {
  if (!z) return `<div class="next"><span class="lbl" data-tier="label">Next</span><span class="v" data-tier="minor">End of class</span></div>`;
  return `<div class="next"><span class="lbl" data-tier="label">Next</span><span class="chip z${z}" data-tier="minor">${z}</span>`
    + `<span class="v nm" data-tier="minor" data-clamp="1">${esc(name)}</span><span class="v" data-tier="minor">${esc(len)}</span>`
    + `<span class="more"><span class="v dim" data-tier="minor">${esc(cad)}</span><span class="v dim" data-tier="minor">${esc(pos)}</span></span></div>`;
}

// The score. Times are seconds from now; play.css turns them into positions with the layout's
// --sps (vw per second): 6 minutes across the screen in landscape, 3 in portrait, "now" at 25 vw.
// blocks: [t0, t1, zone, name] (zone null: wholly past, grey); clips: [t0, t1, title, artist,
// bpm, phrase s]; moments: [t, label]; end: t of the class's end, if on screen.
function score(blocks, clips, moments = [], end = null) {
  const pos = (t0, t1) => `--t0:${t0};--t1:${t1}`;
  // Not drawn where it starts right of the window: "pfar" beyond portrait's 135 s ahead.
  const far = (t0) => (t0 >= 135 ? ' pfar' : '');
  const b = blocks.filter(([t0]) => t0 < 270).map(([t0, t1, z, name]) => (z
    ? `<div class="block z${z}${far(t0)}" style="${pos(t0, t1)}"><span class="n" data-tier="minor">${z}</span><span class="t" data-tier="label" data-fit="hide">${esc(name)}</span></div>`
    : `<div class="block gone" style="${pos(t0, t1)}"></div>`)).join('');
  const c = clips.filter(([t0]) => t0 < 270).map(([t0, t1, title, artist, bpm, ph]) => `<div class="clip${far(t0)}" style="${pos(t0, t1)};--ph:${ph}">`
    + (title ? `<span class="head"><b data-tier="label" data-clamp="1">${esc(title)}</b></span><span class="a" data-tier="label" data-fit="hide">${esc(artist)}</span><span class="bpm" data-tier="label" data-fit="hide">${bpm} bpm</span>` : '')
    + '</div>').join('');
  const m = moments.map(([t, label]) => `<div class="moment${far(t)}" style="--t0:${t}"><span data-tier="label">${esc(label)}</span></div>`).join('');
  const e = end === null ? '' : `<div class="end" style="--t0:${end}"><span data-tier="label">End</span></div>`;
  return `<section class="score"><div class="track iv">${b}</div><div class="track songs">${c}${m}</div>${e}<div class="past"></div><div class="now"></div></section>`;
}

// The control band (room-2d.md, "Controls on the room screen"): words, never icons. A word is
// tier label as on the room screen; play.css holds it to the minor floor on phone sizes. On this page
// there is no class code slot: the page hosts no live session (ADR 0008 section 1).
const btn = (action, word, sub, cls = '') => `<button class="btn${cls ? ' ' + cls : ''}" data-action="${action}"><span class="w" data-tier="label">${esc(word)}</span>${sub ? `<span class="sub" data-tier="label">${esc(sub)}</span>` : ''}</button>`;
function band(kind) {
  if (kind === 'ask') {
    return `<nav class="controls" aria-label="Class controls"><div class="ask"><span class="q" data-tier="minor">End the class?</span>`
      + `${btn('end-class', 'End class', 'Back to the class list')}<span class="gap"></span>${btn('keep-going', 'Keep going', '', 'main focus quit')}</div></nav>`;
  }
  if (kind === 'close') return `<nav class="controls" aria-label="Class controls">${btn('close', 'Close class', 'Back to the class list', 'main quit')}</nav>`;
  const main = { start: 'Start', pause: 'Pause', resume: 'Resume' }[kind];
  return `<nav class="controls" aria-label="Class controls"><div class="transport">${btn('previous', 'Previous', 'Interval')}${btn(kind, main, '', 'main')}${btn('next', 'Next', 'Interval')}</div>`
    + `${btn('end', 'End', '', 'quit')}</nav>`;
}

// Before the start and "Class Complete": the class title, its facts and the time in each zone.
function intro(title, facts, zones) {
  const long = title.length > 26;
  const f = facts.map(([l, v]) => `<div><span class="lbl" data-tier="label">${esc(l)}</span><span class="v n" data-tier="value">${esc(v)}</span></div>`).join('');
  const z = zones.map(([n, tm, name]) => `<div class="z${n}"><span class="n" data-tier="minor">${n}</span><span class="tm" data-tier="minor">${esc(tm)}</span><span class="t" data-tier="label" data-lines="2" data-clamp="2">${esc(name)}</span></div>`).join('');
  return `<section class="intro"><h1 data-tier="value"${long ? ' class="long" data-lines="2" data-clamp="2"' : ''}>${esc(title)}</h1><div class="facts">${f}</div>`
    + `<div class="zwrap"><span class="lbl ztitle" data-tier="label">Time in each zone, as planned</span><div class="zones">${z}</div></div></section>`;
}

// A room page. shown: the band is shown (or pinned). The class "play" scopes play.css.
function room(title, comment, body, shown) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="room.css">
<link rel="stylesheet" href="controls.css">
<link rel="stylesheet" href="play.css">
</head>
<body class="play${shown ? ' shown' : ''}">
<!-- ${comment}  Spec: docs/design/play.md. Generated by play-pages.js: edit that, not this file. -->
${body}
</body>
</html>
`;
}

module.exports = { esc, digits, gel, rail, clock, metrics, cue, next, score, band, intro, room };

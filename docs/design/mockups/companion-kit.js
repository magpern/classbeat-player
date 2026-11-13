// Building blocks of the handlebar companion mock-ups (docs/design/companion.md). Pure string
// functions: no I/O. Every piece of text is a leaf with data-tier, so measure.js checks it.
// Tiers: gel (zone numeral), hero (time left), value, text (cue), textmin (long cue, set by CSS),
// minor, label. Every key carries data-action; class-moving keys carry data-guard="hold".
'use strict';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const T = (tier, text, lines = 1, extra = '') => `<span data-tier="${tier}" data-lines="${lines}"${extra}>${esc(text)}</span>`;
// A running number: each digit in its cell.
const digits = (s) => esc(s).replace(/\d/g, (d) => `<span class="d">${d}</span>`);

// The top line: the music link (grey, or a white plate when something is wrong) and class time.
function top(link, kind = '', time = '', timeLabel = 'left', noteHtml = '') {
  const t = time ? `<span class="ct"><span class="val" data-tier="minor">${digits(time)}</span>${T('label', timeLabel)}</span>` : '';
  return `<header class="top">${noteHtml || `<span class="link ${kind}" data-tier="label" data-lines="2">${esc(link)}</span>`}${t}</header>`;
}

// The gel: zone number, name and up to three targets. o.down: lights down; o.blank: no zone.
function gel(z, name, targets = [], o = {}) {
  if (o.blank) return `<section class="gel blank"><div class="gel-txt">${T('value', name, 1, ' class="gel-name n"')}${T('minor', o.sub || '', 1, ' class="gel-tg"')}</div></section>`;
  const long = name.length > 24;
  const lbl = o.label ? T('label', o.label, 1, ' class="lbl"') : '';
  const tg = targets.length ? `<div class="gel-tg" data-tier="minor" data-lines="2">${targets.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : '';
  return `<section class="gel z${z}${o.down ? ' down' : ''}"><span class="gel-num n" data-tier="gel">${z}</span>`
    + `<div class="gel-txt">${lbl}<span class="gel-name n${long ? ' long' : ''}" data-tier="value" data-lines="2" data-clamp="2">${esc(name)}</span>${tg}</div></section>`;
}

// The clock row: time left in the interval, and the next song change beside it (under it in
// landscape). o.label, o.est (estimated), o.pill ("Paused"). song: { when, title, artist, dim,
// label } from nextSong, or null: "None left".
function clock(time, song, o = {}) {
  const pill = o.pill ? `<span class="pill" data-tier="label">${esc(o.pill)}</span>` : '';
  const sg = song
    ? `<div class="song">${T('label', song.label || 'Next song', 1, ' class="lbl"')}<span class="when n${song.dim ? ' dim' : ''}" data-tier="value" data-lines="2">${esc(song.when)}</span>`
      + `${T('minor', song.title, 1, ' class="st" data-clamp="1"')}${T('label', song.artist, 1, ' class="sa" data-clamp="1"')}</div>`
    : `<div class="song">${T('label', 'Next song', 1, ' class="lbl"')}${T('value', 'None left', 1, ' class="when n"')}</div>`;
  return `<section class="clock"><div class="cl"><span class="lbl">${pill}${T('label', o.label || 'Interval left')}</span>`
    + `<div class="count n${o.est ? ' est' : ''}" data-tier="hero">${digits(time)}</div></div>${sg}</section>`;
}

// The cue, as written. Over 60 characters it steps down (CSS: .long).
const cue = (text, o = {}) => `<p class="cue${text.length > 60 ? ' long' : ''}${o.title ? ' title' : ''}" data-tier="text" data-lines="${o.lines || 8}">${o.label ? `<span class="cue-lbl lbl" data-tier="label">${esc(o.label)}</span>` : ''}${esc(text)}</p>`;

// Coming up: rows of [zone number, zone name, length] from `next`; none: "End of class".
function coming(rows) {
  const r = rows.length ? rows.map(([z, name, len], k) => `${k ? '<span></span>' : T('label', 'Next', 1, ' class="lbl"')}<div class="next"><span class="chip z${z}" data-tier="minor">${z}</span>`
    + `<span class="v nm" data-tier="minor" data-clamp="1">${esc(name)}</span><span class="v dim" data-tier="minor">${esc(len)}</span></div>`).join('')
    : `${T('label', 'Next', 1, ' class="lbl"')}<div class="next">${T('minor', 'End of class', 1, ' class="v"')}</div>`;
  return `<section class="coming">${r}</section>`;
}

// A key. o: guard ('hold'), hint, main, dis, half, full, p (hold progress), delta (nudge ms).
function key(action, label, o = {}) {
  const c = ['key', o.main && 'main', o.dis && 'dis', o.half && 'half', o.full && 'full', o.p && 'holding'].filter(Boolean).join(' ');
  const hint = o.hint ? T('label', o.hint, 2, ' class="kh"') : '';
  return `<button class="${c}" data-action="${action}"${o.delta ? ` data-delta="${o.delta}"` : ''}${o.guard ? ` data-guard="${o.guard}"` : ''}${o.dis ? ' aria-disabled="true"' : ''}>`
    + `<span class="kl" data-tier="minor" data-lines="2">${esc(label)}</span>${hint}${o.p ? `<span class="prog" style="--p:${o.p}"></span>` : ''}</button>`;
}
const keys = (...list) => `<nav class="keys" aria-label="Steer the class">${list.join('')}</nav>`;
const msg = (text) => `<div class="msg">${T('minor', text, 2)}</div>`;

// The set while the class runs: the contract's actions only (start, pause, resume, skip, nudge,
// undo_resync). o.follow: link.mode is following, so the nudges are greyed (never while
// following) and skip goes to the next song. o.paused, o.p (hold progress on skip),
// o.noSkip (skip not in `allowed`, with o.noSkip as the reason), o.notice (takes skip's row).
function runKeys(o = {}) {
  const why = 'Not while following';
  const nudge = (d, label) => key('nudge', label, o.follow ? { delta: d, dis: true, hint: why } : { delta: d });
  const pause = o.paused
    ? key('resume', 'Resume', { main: true, guard: 'hold', hint: 'Hold' })
    : key('pause', 'Pause', { main: true });
  const skipLabel = o.follow ? 'Next song' : 'Next interval';
  const skip = o.noSkip
    ? key('skip', skipLabel, { full: true, guard: 'hold', dis: true, hint: o.noSkip })
    : key('skip', o.p ? 'Keep holding' : skipLabel, { full: true, guard: 'hold', hint: 'Hold', p: o.p });
  return keys(nudge(-5000, 'Back 5\u00a0s'), pause, nudge(5000, 'Forward 5\u00a0s'), o.notice || skip);
}

// A notice in skip's row: the resync announcement with its one-touch undo while canUndo
// (ADR 0001, timing model item 5), or a refused command. undo: show the Undo key.
const notice = (head, detail, undo = true) => `<div class="notice" role="status"><div class="nt">${T('minor', head, 3, ' class="h"')}${detail ? T('label', detail, 3, ' class="dt"') : ''}</div>${undo ? key('undo_resync', 'Undo') : ''}</div>`;
// A short "done" note in the top line, in place of the link for 3 s.
const note = (head) => `<span class="note" role="status">${T('label', head, 1, ' class="h" data-clamp="1"')}</span>`;

function doc(title, comment, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="companion.css">
</head>
<body>
<!-- ${comment}  Spec: docs/design/companion.md. Generated by companion-pages.js: edit that, not this file. -->
${body}
</body>
</html>
`;
}

module.exports = { esc, T, digits, top, gel, clock, cue, coming, key, keys, msg, runKeys, notice, note, doc };

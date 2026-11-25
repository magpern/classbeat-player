// The download page mock-ups (docs/design/download.md), one entry per state. `node download-pages.js`
// writes download-<name>.html beside this file. Every name, date and checksum is made up; the
// checksums are the SHA-256 of the file names, so they are stable. Run from anywhere.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { T, h1, btn, status, frame } = require('./site-kit');

const FILES = [
  ['macOS, Apple silicon', 'classbeat-player-macos-arm64-unsigned.tar.gz'],
  ['macOS, Intel', 'classbeat-player-macos-x64-unsigned.tar.gz'],
  ['Windows, 64-bit', 'classbeat-player-windows-x64-unsigned.tar.gz'],
  ['Linux, 64-bit', 'classbeat-player-linux-x64-unsigned.tar.gz'],
];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Eight groups of eight characters, in two halves, with no whitespace between them (a copy has no spaces).
const sum = (hex) => `<div class="sum" data-tier="minor" data-min-cap="12" data-lines="4">${[0, 32].map((i) => `<span class="h">${hex.slice(i, i + 32).match(/.{8}/g).map((g) => `<span class="g">${g}</span>`).join('')}</span>`).join('')}</div>`;
// The signing label: a mark and the word, never colour (the page has none).
const badge = (signed) => `<span class="tag"><span class="mark ${signed ? 'ok' : 'away'}"></span>${T('small', signed ? 'Signed' : 'Unsigned', 1)}</span>`;

const row = ([sys, file], signed) => {
  const id = `s-${sha(file).slice(0, 6)}`;
  return `<section class="dl-row" aria-labelledby="${id}">
<div class="sys"><span class="n" id="${id}">${T('h2', sys, 2)}</span>${badge(signed)}</div>
<div class="file">${T('small', file, 3)}</div>
<div><div class="sumlab">${T('label', 'SHA-256 checksum', 1)}</div>${sum(sha(file))}</div>
<div class="go">${btn('Download', { primary: true, link: true }).replace('role="link"', `role="link" aria-label="Download for ${sys}"`)}</div>
</section>`;
};

// Part of the page, not an answer to an action, so it has no alert role.
const unsigned = `<section class="plate unsigned" aria-labelledby="u-h"><div class="head2"><span class="mark away"></span><span id="u-h">${T('title', 'These builds are unsigned', 3)}</span></div>
<p class="dt">${T('body', 'macOS and Windows will warn you when you open them.')}</p>
<p class="dt">${T('body', '[Owner wording: how to open an unsigned build]')}</p></section>`;

const check = `<section class="check" aria-labelledby="c-h"><h2 id="c-h">${T('h2', 'Check a download', 3)}</h2><dl>
<dt>${T('body', 'macOS and Linux', 1)}</dt><dd>${T('body', 'Run shasum -a 256 on the file and compare the result with the checksum above.', 3)}</dd>
<dt>${T('body', 'Windows', 1)}</dt><dd>${T('body', 'Run certutil -hashfile on the file with SHA256 and compare the result with the checksum above.', 3)}</dd>
</dl></section>`;

const ver = (v, date) => `<div class="ver"><span class="num" data-tier="minor" data-min-cap="17" data-lines="1">Version ${v}</span><span class="when">${T('body', `Released ${date}`, 2)}</span></div>
<a class="a ul notes" href="#">${T('body', `Release notes for ${v}`, 3)}</a>`;

const pages = {};
const add = (name, title, body, comment) => { pages[name] = { title, body, comment }; };
const HEAD = h1('Download the player');

add('found', 'Latest found', `${HEAD}${ver('0.1.0', '25 Nov 2026')}${unsigned}<div class="dl">${FILES.map((f) => row(f, false)).join('')}</div>${check}`,
  'State: latest found. The build-time release data holds one release with four unsigned builds.');
add('loading', 'Loading', `${HEAD}${status('Looking for the latest release')}<div class="dl">${FILES.map(([s]) => `<section class="dl-row wait" aria-busy="true"><div class="sys"><span class="n">${T('h2', s, 2)}</span></div><div class="w">${T('body', 'Loading', 1)}</div></section>`).join('')}</div>`,
  'State: loading. The four systems are known at build time, so the rows keep their place and nothing jumps when the data is read.');
add('none', 'No release yet', `${HEAD}<div class="note" role="status"><div class="head2"><span class="mark ok"></span>${T('title', 'No release yet', 3)}</div><p class="dt">${T('small', 'No version of the player has been published. It will be listed here when there is one.')}</p></div>`,
  'State: no release yet. The release data holds no release: no list, no notice, no download button.');
add('error', 'Could not read the list', `${HEAD}<div class="plate" role="alert"><div class="head2"><span class="mark away"></span>${T('title', 'The list of releases could not be read', 3)}</div><p class="dt">${T('body', 'Reload the page. If it happens again, the page is at fault, not your computer.')}</p><div class="btns">${btn('Reload', { q: true })}</div></div>`,
  'State: the build-time release data could not be read. A fourth state, beyond the three the issue names.');

const NAMES = Object.keys(pages);
if (require.main === module) {
  for (const n of NAMES) {
    const { title, body, comment } = pages[n];
    const html = frame({ title: `Download: ${title}`, nav: null, body, comment, narrow: false })
      .replace('<link rel="stylesheet" href="site.css">', '<link rel="stylesheet" href="site.css">\n<link rel="stylesheet" href="download.css">')
      .replace('Spec: docs/design/site.md. Generated by site-pages.js: edit that', 'Spec: docs/design/download.md. Generated by download-pages.js: edit that');
    fs.writeFileSync(path.join(__dirname, `download-${n}.html`), html);
  }
  console.log(`${NAMES.length} mock-ups written`);
}
module.exports = { NAMES, pages };

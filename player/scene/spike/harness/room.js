'use strict';
// Room window: large HTML text over the scene (or the plain 2D screen). Text is never baked into the scene.
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'plain' ? 'plain' : 'scene';
const variant = /^[a-z]+$/.test(params.get('variant') || '') ? params.get('variant') : 'web';
const $ = (id) => document.getElementById(id);
const fmt = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
document.body.classList.add(mode);
$('mode').textContent = mode === 'plain' ? 'plain 2D' : variant;

let current = null;
window.__roomState = null;

function render(s) {
  window.__roomState = s;
  const z = s.zones[s.interval.zone];
  $('zone').textContent = `ZONE ${z.number} ${z.name}`;
  $('zone').style.color = mode === 'plain' ? '#fff' : z.color;
  $('name').textContent = s.interval.name;
  $('left').textContent = fmt(s.remainingMs);
  $('cadence').textContent = `${s.interval.rpm[0]}-${s.interval.rpm[1]} rpm`;
  $('bpm').textContent = `${s.interval.bpm} bpm`;
  $('next').textContent = s.next ? `Next: ${s.next.name}, zone ${s.next.zone} ${s.zones[s.next.zone].name}` : 'Last interval';
  if (mode === 'plain') {
    document.body.style.setProperty('--zone-dark', z.color + '55');
    if (!current || current.totalMs !== s.totalMs) buildScore(s);
    [...$('score2d').children].forEach((el, i) => el.classList.toggle('cur', i === s.index));
  }
  current = s;
}

function buildScore(s) {
  const root = $('score2d');
  root.innerHTML = '';
  // Plain 2D upcoming-intervals strip: widths follow duration only, heights are constant.
  for (const i of s.classDef.intervals) {
    const d = document.createElement('div');
    d.style.flex = String(i.end - i.start);
    d.style.background = s.zones[i.zone].color;
    root.appendChild(d);
  }
}

window.spike.getState().then(async (s) => {
  window.spike.onState(render);
  render(s);
  if (mode === 'scene') {
    const m = await import(`../${variant}/scene.js`);
    m.mountScene($('scene'), () => window.__roomState, (fps) => window.spike.reportFps(fps));
  }
});

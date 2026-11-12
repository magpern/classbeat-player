'use strict';
const fmt = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const $ = (id) => document.getElementById(id);

let current = { variants: [], variant: '' };
function render(s) {
  current = s;
  $('time').textContent = `${fmt(s.elapsedMs)} / ${fmt(s.totalMs)} ${s.running ? '' : '(paused)'}`;
  $('now').textContent = `${s.interval.name} - zone ${s.interval.zone} ${s.zones[s.interval.zone].name}, ${fmt(s.remainingMs)} left`;
  $('mode').textContent = `${s.roomMode} (${s.variant})`;
  $('capture').textContent = s.lastCapture ? `last screenshot: ${s.lastCapture}` : '';
  if ($('variants').dataset.v !== s.variant) {
    $('variants').dataset.v = s.variant;
    $('variants').replaceChildren(...s.variants.map((v) => {
      const b = document.createElement('button');
      b.textContent = v + (v === s.variant ? ' (now)' : '');
      b.disabled = v === s.variant;
      b.addEventListener('click', () => run({ type: 'variant', variant: v }));
      return b;
    }));
  }
  $('recovery').textContent = s.recovery ? `last recovery: ${s.recovery.ok ? 'ok' : 'LATE'} in ${Math.round(s.recovery.latencyMs)} ms` : '';
  $('displays').innerHTML = '<tr><th>N</th><th>Bounds</th><th>Scale</th><th></th></tr>' + s.displays.map((d) =>
    `<tr><td>${d.n}</td><td>${d.bounds.width}x${d.bounds.height} at ${d.bounds.x},${d.bounds.y}</td><td>${d.scale}</td><td>${d.primary ? 'primary ' : ''}${d.room ? 'room screen' : ''}</td></tr>`).join('');
}

const run = (c) => window.spike.command(c).then(render);
const actions = {
  toggle: { type: 'toggle' }, reset: { type: 'reset' }, 'kill-scene': { type: 'kill-scene' }, capture: { type: 'capture' },
  'mode-plain': { type: 'mode', mode: 'plain' }, 'mode-scene': { type: 'mode', mode: 'scene' },
};
document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => run(actions[b.dataset.cmd])));
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); run(actions.toggle); }
  else if (k === 'r') run(actions.reset);
  else if (k === 'k') run(actions['kill-scene']);
  else if (k === 'p') run(actions['mode-plain']);
  else if (k === 's') run(actions['mode-scene']);
  else if (k === 'c') run(actions.capture);
  else if (k === 'v') { const i = current.variants.indexOf(current.variant); run({ type: 'variant', variant: current.variants[(i + 1) % current.variants.length] }); }
  else if (/^[1-9]$/.test(k)) run({ type: 'move-room', n: Number(k) });
});
window.spike.onState(render);
window.spike.getState().then(render);

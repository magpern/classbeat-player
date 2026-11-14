'use strict';
// One-screen controls overlay: the presenter's controls drawn ON TOP of the full screen class view
// (the view is never resized). Hidden with the class running; a mouse move or a key shows it for a
// few seconds. The keyboard works with it hidden. It lives in the room page (overlay=1) or, for
// godot-native, where Godot's window is on top, in the shell's transparent overlay window (band.html).
(() => {
const fmt = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const CSS = `
/* The product's controls band (web/src/play/play-room.css, tokens.css): opaque panel, dark raised buttons, light text. */
#band { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; box-sizing: border-box; padding: 1.2vh 1.5vw;
  display: flex; flex-direction: column; justify-content: center; gap: 1vh; background: #000000; color: #f6f4ef;
  border-top: .3vh solid #3a3a42; font: clamp(16px, 1.5vw, 30px) system-ui, "Segoe UI", Arial, sans-serif; transition: opacity .2s; }
#band.hidden { opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { #band { transition: none; } }
#band .line { font-variant-numeric: tabular-nums; }
#band .rec { color: #bdbab2; }
#band .row { display: flex; flex-wrap: wrap; align-items: center; gap: .4em; }
#band button { font: inherit; font-weight: 700; padding: .4em .8em; margin: 0; background: #17171c; color: #f6f4ef;
  border: .3vh solid #3a3a42; border-radius: .8vh; cursor: default; }
#band button:focus-visible { outline: .4vh solid #f6f4ef; outline-offset: .3vh; }
#band button:disabled { color: #f6f4ef; border-color: #f6f4ef; opacity: 1; } /* the variant now running: readable, outlined */
#band button.quit { margin-left: auto; }
#band kbd { background: #3a3a42; color: #f6f4ef; padding: 0 .4em; border-radius: 3px; font: inherit; font-size: .85em; }`;
const HTML = `<div class="line"></div>
<div class="row"><button data-cmd="toggle">Start / pause <kbd>Space</kbd></button>
<button data-cmd="reset">Reset <kbd>R</kbd></button>
<button data-cmd="kill-scene">Kill scene <kbd>K</kbd></button>
<button data-cmd="mode-plain">Plain 2D <kbd>P</kbd></button>
<button data-cmd="mode-scene">Scene <kbd>S</kbd></button>
<button data-cmd="capture">Screenshot <kbd>C</kbd></button>
<button data-cmd="quit" class="quit">Quit</button></div>
<div class="row">Variant <kbd>V</kbd>: <span class="variants"></span> <span class="rec"></span></div>`;
const actions = {
  toggle: { type: 'toggle' }, reset: { type: 'reset' }, 'kill-scene': { type: 'kill-scene' }, capture: { type: 'capture' },
  'mode-plain': { type: 'mode', mode: 'plain' }, 'mode-scene': { type: 'mode', mode: 'scene' }, quit: { type: 'quit' },
};

function mount() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const band = document.createElement('div');
  band.id = 'band';
  band.className = 'hidden';
  band.innerHTML = HTML;
  document.body.appendChild(band);
  const q = (s) => band.querySelector(s);
  let current = { variants: [], variant: '', running: false };
  let wakeAt = null;
  let shown = null;

  const paint = () => {
    const v = window.SpikeBand.bandVisible({ running: current.running, wakeAt, now: performance.now() });
    band.classList.toggle('hidden', !v);
    if (v !== shown) { shown = v; window.spike.reportOverlay(v); } // the overlay window is click-through while hidden
  };
  let reportedAt = -1e9;
  const wake = () => {
    wakeAt = performance.now();
    paint();
    // Tell the shell it is shown (throttled): the overlay window takes the keyboard back.
    if (wakeAt - reportedAt > 500) { reportedAt = wakeAt; window.spike.reportOverlay(true); }
  };
  const run = (c) => { wake(); return window.spike.command(c).then(render); };
  function render(s) {
    if (!s) return;
    current = s;
    q('.line').textContent = `${fmt(s.elapsedMs)} / ${fmt(s.totalMs)} ${s.running ? '' : '(paused)'}  ${s.interval.name}, zone ${s.interval.zone}  [${s.roomMode}, ${s.variant}]`;
    q('.rec').textContent = s.recovery ? `last recovery: ${s.recovery.ok ? 'ok' : 'LATE'} in ${Math.round(s.recovery.latencyMs)} ms` : '';
    if (q('.variants').dataset.v !== s.variant) {
      q('.variants').dataset.v = s.variant;
      q('.variants').replaceChildren(...s.variants.map((v) => {
        const b = document.createElement('button');
        b.textContent = v + (v === s.variant ? ' (now)' : '');
        b.disabled = v === s.variant;
        b.addEventListener('click', () => run({ type: 'variant', variant: v }));
        return b;
      }));
    }
    paint();
  }
  band.querySelectorAll('button[data-cmd]').forEach((b) => b.addEventListener('click', () => run(actions[b.dataset.cmd])));
  window.addEventListener('keydown', (e) => {
    const c = window.SpikeKeymap.routeKey(e.key, current);
    if (c) { e.preventDefault(); run(c); } else wake();
  });
  window.addEventListener('mousemove', wake);
  window.spike.onWake(wake); // the cursor moved anywhere on the screen (the main process polls it for the overlay window)
  window.spike.onState(render);
  window.spike.getState().then(render);
  setInterval(paint, 250);
}

if (location.pathname.endsWith('band.html') || new URLSearchParams(location.search).get('overlay') === '1') mount();
})();

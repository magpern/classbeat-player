// Spike 2, Godot web-export variant: the same scene as godot/, exported for the web and run inside
// the room window. Godot draws only the scene; the large text is the room page's HTML, as in the web
// variant. The page pushes the shell's state into Godot through a callback Godot registers
// (window.spikeRegister); Godot reports its frame rate through window.spikeFps. The build is served
// by the shell under godotweb://app/ (harness/godot-web.js); it is never committed.
const BASE = 'godotweb://app/index';

export function mountScene(container, getState, reportFps) {
  const canvas = document.createElement('canvas');
  canvas.id = 'godot-canvas';
  container.appendChild(canvas);

  let push = null;
  let lastPushed = null;
  window.spikeRegister = (cb) => { push = cb; };
  window.spikeFps = (v) => reportFps(v);
  const loop = () => {
    requestAnimationFrame(loop);
    const s = getState();
    if (push && s && s !== lastPushed) { lastPushed = s; push(JSON.stringify({ type: 'state', ...s })); }
  };
  requestAnimationFrame(loop);

  const script = document.createElement('script');
  script.src = `${BASE}.js`;
  script.onerror = () => console.error('godot web build missing: run npm run godot:export');
  script.onload = () => {
    const engine = new window.Engine({ executable: BASE, canvas, canvasResizePolicy: 2, focusCanvas: false });
    engine.startGame({}).catch((e) => console.error('godot web start failed', e));
  };
  document.head.appendChild(script);
}

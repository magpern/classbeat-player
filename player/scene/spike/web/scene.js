// Spike 2, web variant: a rough light show in three.js. No road, no terrain, no world, no riders:
// an abstract body of light (zone colour, pulsing on the BPM) and a flat sideways score
// (intervals above, songs below) moving under a fixed "now" line. Bar heights are constant:
// nothing here takes a slope or height from an interval.
import * as THREE from '../node_modules/three/build/three.module.js';

const WINDOW_S = 150; // seconds of score visible
const NOW_X = 0.28; // fixed "now" line, as a share of the width

export function mountScene(container, getState, reportFps) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x05050a);
  container.appendChild(renderer.domElement);

  // Light body.
  const world = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.position.z = 9;
  const body = new THREE.Group();
  world.add(body);
  const glows = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1 + i * 0.55, 32, 24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 / (i + 1), blending: THREE.AdditiveBlending, depthWrite: false }));
    body.add(m); glows.push(m);
  }
  const beams = new THREE.Group();
  world.add(beams);
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 22),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    b.rotation.z = (i / 14) * Math.PI;
    beams.add(b);
  }

  // Score: orthographic, pixel units, drawn over the bottom of the window.
  const score = new THREE.Scene();
  const ocam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const bars = [];
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const nowLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(0xffffff));
  score.add(nowLine);

  let W = 1; let H = 1; let builtFor = null;
  function resize() {
    W = container.clientWidth || window.innerWidth; H = container.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    ocam.right = W; ocam.top = H; ocam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function buildScore(s) {
    for (const b of bars) { score.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    bars.length = 0;
    const add = (item, lane, color) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(color));
      score.add(mesh); bars.push({ mesh, item, lane });
    };
    for (const i of s.classDef.intervals) add(i, 0, new THREE.Color(s.zones[i.zone].color));
    for (const x of s.classDef.songs) add(x, 1, new THREE.Color('#2c2f45'));
    builtFor = s.classDef;
  }

  let frames = 0; let last = performance.now(); let fpsT = last;
  function frame(t) {
    requestAnimationFrame(frame);
    const s = getState();
    if (s) {
      if (builtFor !== s.classDef) buildScore(s);
      const zone = new THREE.Color(s.zones[s.interval.zone].color);
      const intensity = 0.55 + 0.1 * s.interval.zone; // brightness only, never shape
      const el = s.elapsedMs / 1000;
      const beat = el * s.interval.bpm / 60; // beat phase, driven by the clock
      const pulse = Math.exp(-(beat % 1) * 4.5);
      glows.forEach((g, i) => { g.material.color.copy(zone); g.material.opacity = (0.5 / (i + 1)) * intensity * (0.7 + 0.5 * pulse); });
      body.scale.setScalar(1 + 0.18 * pulse);
      beams.children.forEach((b) => b.material.color.copy(zone));
      beams.rotation.z = el * 0.15;
      beams.scale.setScalar(1 + 0.1 * pulse);

      // Score geometry.
      const px = W / WINDOW_S;
      const laneH = H * 0.06;
      const base = H * 0.03;
      const nowX = W * NOW_X;
      for (const b of bars) {
        const x0 = nowX + (b.item.start / 1000 - el) * px;
        const x1 = nowX + (b.item.end / 1000 - el) * px;
        const y = base + (b.lane === 0 ? laneH * 1.15 : 0);
        b.mesh.position.set((x0 + x1) / 2, y + laneH / 2, 0);
        b.mesh.scale.set(Math.max(0, x1 - x0 - 3), laneH, 1);
        b.mesh.visible = x1 > 0 && x0 < W;
      }
      nowLine.position.set(nowX, base + laneH * 1.1, 0.5);
      nowLine.scale.set(3, laneH * 2.6, 1);
    }
    renderer.autoClear = true;
    renderer.render(world, cam);
    renderer.autoClear = false;
    renderer.render(score, ocam);

    frames++;
    if (t - fpsT >= 1000) { reportFps(frames * 1000 / (t - fpsT)); frames = 0; fpsT = t; }
    last = t;
  }
  requestAnimationFrame(frame);
}

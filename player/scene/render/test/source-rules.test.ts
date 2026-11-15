// Rule guards on the renderer's source (plan section 3, scene.md "The product rules"). They are
// checked on code only (comments may name a rule). A rule guard is never weakened: adding to a list
// here is allowed, removing from it is not.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RENDER_DIR } from "../tools/tokens-file.ts";

const read = (dir: string) => readdirSync(join(RENDER_DIR, dir)).filter((f) => f.endsWith(".ts")).map((f) => ({ name: `${dir}/${f}`, text: readFileSync(join(RENDER_DIR, dir, f), "utf8") }));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = [...read("src"), ...read("demo")].map((s) => ({ ...s, text: code(s.text) }));

const FORBIDDEN: readonly [string, RegExp][] = [
  ["audio (rule 3)", /\bnew\s+Audio\b|<audio\b|<video\b|\bAudioContext\b|\bMediaSource\b|\.play\s*\(|\bgetUserMedia\b|\b\w*(Audio|Loader)\w*\b/],
  ["a Spotify interface (rule 3)", /spotify\.com|api\.spotify|sdk\.scdn|Spotify\.Player/i],
  ["equipment control (rule 2)", /\bnavigator\.(bluetooth|usb|serial|hid)\b|\bresistance\b|\bsetSpeed\b|\bbrake\b/i],
  ["a camera or microphone (rule 12)", /\bmediaDevices\b/],
  ["a network request or storage", /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/],
  ["randomness", /Math\.random|\bcrypto\b|getRandomValues/],
  ["a beacon, a dynamic import or a worker", /sendBeacon|\bimport\s*\(|\bWorker\b|WebTransport|RTCPeerConnection|document\.cookie|\bcaches\b/],
];for (const [what, re] of FORBIDDEN) {
  test(`no ${what} in the renderer`, () => assert.deepEqual(sources.filter((s) => re.test(s.text)).map((s) => s.name), []));
}

test("rule 5: the camera is created once and never moved, turned or re-aimed", () => {
  const moves = /camera\.(position|rotation|quaternion|up)\b|\.lookAt\(|camera\.(translate|rotate)\w*\(|camera\.fov\s*=|camera\.zoom/;
  assert.deepEqual(sources.filter((s) => moves.test(s.text)).map((s) => s.name), []);
  const rig = sources.find((s) => s.name === "src/rig.ts")!.text;
  assert.match(rig, /camera\.aspect = aspect;\s*this\.camera\.updateProjectionMatrix\(\)/); // the one thing that may change
});

test("rule 4: the files that aim beams know nothing of the interval, the zone, a cadence, a position, a pattern or a cue", () => {
  for (const name of ["src/aim.ts", "src/fixtures.ts"]) {
    const text = sources.find((s) => s.name === name)!.text;
    assert.doesNotMatch(text, /interval|\bzone\b|cadence|position:\s*["']|pattern|\bcue\b|classMs|songPosMs/i, name);
  }
  const rig = sources.find((s) => s.name === "src/rig.ts")!.text;
  assert.doesNotMatch(rig, /intervals|classMs|songPosMs|cadence|pattern|\bcue\b/i);
  assert.match(rig, /aimQuaternion\(draw\.drawn\[i\]/); // a beam is aimed by the model's drawn direction and by nothing else
});

test("the renderer passes on the model's moments and never makes its own", () => {
  const all = sources.filter((s) => s.name.startsWith("src/")).map((s) => s.text).join("\n");
  assert.doesNotMatch(all, /gather\s*[:=]\s*true|fan\s*[:=]\s*true|breakdown\s*[:=]\s*true/); // only the model sets them
  assert.match(sources.find((s) => s.name === "src/bursts.ts")!.text, /gatedBurst\(/);
  assert.match(sources.find((s) => s.name === "src/bursts.ts")!.text, /momentsAllowed\(/);
});

test("no rider data and no hue of its own: the feed is the class clock's state and nothing else", () => {
  const loop = sources.find((s) => s.name === "src/loop.ts")!.text;
  const feed = /export interface Feed \{([\s\S]*?)\n\}/.exec(loop)![1]!;
  assert.deepEqual([...feed.matchAll(/readonly (\w+):/g)].map((m) => m[1]), ["cls", "classMs", "songIndex", "songPosMs", "link", "reducedMotion"]);
  assert.doesNotMatch(sources.map((s) => s.text).join("\n"), /\b(heartRate|heart_rate|watts?|riders?)\b/i);
});

test("the only literal colours are black (the stage) and white-for-opacity; every hue comes from tokens.css", () => {
  const literals = sources.filter((s) => s.name.startsWith("src/")).flatMap((s) => [...s.text.matchAll(/0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{6}\b|new Color\([^)]+\)/g)].map((m) => `${s.name} ${m[0]}`));
  assert.deepEqual(literals.filter((l) => !/0x000000|new Color\(1, 1, 1\)|new Color\(\)/.test(l)), []);
});

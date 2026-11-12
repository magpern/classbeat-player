'use strict';
// Static checks of the Godot side: the pin, the presets, no binaries tracked, and the product rules
// that can be checked by reading (no audio, no Spotify, no network beyond 127.0.0.1). No Godot needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha512, PIN } = require('../tools/godot');

const SPIKE = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(SPIKE, ...p), 'utf8');
const files = (dir, ext) => fs.readdirSync(path.join(SPIKE, dir)).filter((f) => ext.test(f) && fs.statSync(path.join(SPIKE, dir, f)).isFile()).map((f) => path.join(dir, f));

test('sha512 helper matches a known digest', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sha-')), 'x');
  fs.writeFileSync(f, 'abc');
  assert.equal(await sha512(f), crypto.createHash('sha512').update('abc').digest('hex'));
});

test('the pin: Godot 4.x stable, official release URL, a 128-hex checksum for every file', () => {
  assert.match(PIN.version, /^4\.\d+\.\d+$/);
  assert.equal(PIN.channel, 'stable');
  assert.equal(PIN.baseUrl, `https://github.com/godotengine/godot/releases/download/${PIN.version}-${PIN.channel}`);
  assert.deepEqual(Object.keys(PIN.files).sort(), ['darwin', 'linux', 'templates', 'win32']);
  for (const [k, f] of Object.entries(PIN.files)) {
    assert.match(f.sha512, /^[0-9a-f]{128}$/, k);
    assert.ok(f.name.includes(PIN.version), k);
  }
  assert.ok(new Date(PIN.published) <= new Date('2026-10-29'), 'at least two weeks old when the spike was written');
});

test('export presets for Linux, Windows, macOS and Web; the web one is single-threaded', () => {
  const cfg = read('godot', 'export_presets.cfg');
  assert.deepEqual([...cfg.matchAll(/^platform="(.+)"$/gm)].map((m) => m[1]), ['Linux', 'Windows Desktop', 'macOS', 'Web']);
  assert.match(cfg, /variant\/thread_support=false/);
});

test('built files are never tracked: the Godot folder ignores editor, templates and builds', () => {
  const ig = read('godot', '.gitignore');
  for (const pat of ['.tools/', 'build/*', '.godot/']) assert.ok(ig.split('\n').includes(pat), pat);
  const tracked = (dir) => fs.readdirSync(path.join(SPIKE, dir)).filter((f) => /\.(exe|wasm|pck|x86_64|zip|tpz|dll|so|dylib|png)$/.test(f));
  assert.deepEqual(tracked('godot'), []);
  assert.deepEqual(tracked('godot-web'), []);
});

test('rule guards: no audio, no Spotify, no network but 127.0.0.1 in the Godot variants', () => {
  const sources = [...files('godot', /\.(gd|tscn|godot|cfg)$/), ...files('godot-web', /\.js$/), ...files('harness', /^godot.*\.js$/)];
  assert.ok(sources.length >= 8);
  for (const f of sources) {
    const text = fs.readFileSync(path.join(SPIKE, f), 'utf8');
    assert.doesNotMatch(text, /spotify|AudioStreamPlayer|AudioStreamMP3|HTTPRequest|HTTPClient|StreamPeerTCP|ENetMultiplayerPeer|UDPServer|PacketPeerUDP/i, f);
    for (const url of text.match(/\b(?:https?|wss?):\/\/[^\s"'`)]+/g) || []) {
      if (f.includes('version.json')) continue;
      assert.match(url, /^(ws:\/\/(127\.0\.0\.1|%s)|wss?:\/\/\$\{)/, `${f}: ${url}`);
    }
  }
  assert.match(read('godot', 'project.godot'), /driver\/driver="Dummy"/, 'the audio driver is the dummy one: no sound device is opened');
  assert.match(read('godot', 'link.gd'), /const HOST := "127\.0\.0\.1"/);
});

test('the scene takes no height or slope from an interval (rule 4): bar heights are constants', () => {
  for (const f of ['godot/score.gd', 'web/scene.js']) {
    const text = read(...f.split('/'));
    assert.doesNotMatch(text, /interval\[?["'.]?(?:rpm|bpm)[^;\n]*(?:height|scale\.y|position\.y)/i, f);
  }
  assert.match(read('godot', 'score.gd'), /var lane_h := h \* 0\.06/);
});

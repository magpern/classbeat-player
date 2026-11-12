'use strict';
// Downloads the pinned Godot editor and export templates (checksum verified), and exports the spike
// scene. Nothing downloaded or built is committed (godot/.gitignore).
//   node tools/godot.js setup                  download, verify and unpack into godot/.tools/
//   node tools/godot.js export [preset ...]    headless export (default: Linux and Web; "all" adds Windows, macOS)
//   node tools/godot.js bin                    print the editor binary path
// Behind a proxy run with NODE_USE_ENV_PROXY=1. A file already in godot/.tools/downloads whose
// checksum matches is reused (so a manual download works too).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PROJECT = path.join(__dirname, '..', 'godot');
const PIN = JSON.parse(fs.readFileSync(path.join(PROJECT, 'version.json'), 'utf8'));
const TOOLS = path.join(PROJECT, '.tools');
const HOME = path.join(TOOLS, PIN.version);
const TEMPLATES = ['version.txt', 'linux_release.x86_64', 'windows_release_x86_64.exe', 'windows_release_x86_64_console.exe', 'macos.zip', 'web_nothreads_release.zip', 'web_release.zip'];
const PRESETS = { linux: 'Linux', windows: 'Windows Desktop', macos: 'macOS', web: 'Web' };
const OUT = { linux: 'linux/classbeat-spike-scene.x86_64', windows: 'windows/classbeat-spike-scene.exe', macos: 'macos/classbeat-spike-scene.zip', web: 'web/index.html' };

const sha512 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha512');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

async function fetchVerified(entry) {
  const dir = path.join(TOOLS, 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, entry.name);
  if (fs.existsSync(file) && await sha512(file) === entry.sha512) return file;
  const res = await fetch(`${PIN.baseUrl}/${entry.name}`);
  if (!res.ok) throw new Error(`download ${entry.name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${file}.part`));
  const got = await sha512(`${file}.part`);
  if (got !== entry.sha512) { fs.rmSync(`${file}.part`); throw new Error(`checksum mismatch for ${entry.name}: ${got}`); }
  fs.renameSync(`${file}.part`, file);
  return file;
}

function unzip(file, dest, members = []) {
  fs.mkdirSync(dest, { recursive: true });
  const r = process.platform === 'win32'
    ? spawnSync('tar', ['-xf', file, '-C', dest, ...members], { stdio: 'inherit' })
    : spawnSync('unzip', ['-q', '-o', file, ...members, '-d', dest], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`unzip failed for ${file}`);
}

function editorBinary() {
  if (process.platform === 'win32') return path.join(HOME, 'editor', `Godot_v${PIN.version}-stable_win64_console.exe`);
  if (process.platform === 'darwin') return path.join(HOME, 'editor', 'Godot.app', 'Contents', 'MacOS', 'Godot');
  return path.join(HOME, 'editor', `Godot_v${PIN.version}-stable_linux.x86_64`);
}

async function setup() {
  if (fs.existsSync(editorBinary()) && fs.existsSync(path.join(HOME, 'editor', 'editor_data', 'export_templates', `${PIN.version}.${PIN.channel}`, 'version.txt'))) return editorBinary();
  const host = PIN.files[process.platform];
  if (!host) throw new Error(`no Godot editor pinned for ${process.platform}`);
  unzip(await fetchVerified(host), path.join(HOME, 'editor'));
  if (process.platform !== 'win32') fs.chmodSync(editorBinary(), 0o755);
  fs.writeFileSync(path.join(HOME, 'editor', '._sc_'), ''); // self-contained: editor data stays in this folder
  const tmp = path.join(HOME, 'tpz');
  unzip(await fetchVerified(PIN.files.templates), tmp, TEMPLATES.map((t) => `templates/${t}`));
  const dest = path.join(HOME, 'editor', 'editor_data', 'export_templates', `${PIN.version}.${PIN.channel}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(path.join(tmp, 'templates'), dest);
  fs.rmSync(tmp, { recursive: true, force: true });
  return editorBinary();
}

function run(bin, args) {
  const r = spawnSync(bin, args, { cwd: PROJECT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`godot ${args.join(' ')} exited with ${r.status}`);
}

async function exportPresets(names) {
  const bin = await setup();
  run(bin, ['--headless', '--path', PROJECT, '--import']);
  for (const n of names) {
    if (!PRESETS[n]) throw new Error(`unknown preset ${n}; use ${Object.keys(PRESETS).join(', ')}`);
    const out = path.join(PROJECT, 'build', OUT[n]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    run(bin, ['--headless', '--path', PROJECT, '--export-release', PRESETS[n], out]);
    if (n === 'macos') { // the native variant runs the unpacked app
      unzip(out, path.join(PROJECT, 'build', 'macos'));
      const exe = path.join(PROJECT, 'build', 'macos', 'classbeat spike scene.app', 'Contents', 'MacOS', 'classbeat spike scene');
      if (fs.existsSync(exe)) fs.chmodSync(exe, 0o755);
    }
    console.log('exported', n, '->', path.relative(process.cwd(), out));
  }
}

module.exports = { sha512, PIN, editorBinary, setup, exportPresets };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const go = cmd === 'setup' ? setup().then((b) => console.log(b))
    : cmd === 'export' ? exportPresets(rest[0] === 'all' ? Object.keys(PRESETS) : rest.length ? rest : ['linux', 'web'])
      : cmd === 'bin' ? Promise.resolve(console.log(editorBinary()))
        : Promise.reject(new Error('usage: godot.js setup | export [preset ...|all] | bin'));
  go.catch((e) => { console.error(e.message); process.exit(1); });
}

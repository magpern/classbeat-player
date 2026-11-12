'use strict';
// Serves the exported Godot web build (godot/build/web, never committed) to the room window under
// the custom scheme godotweb:// . No port is opened and nothing leaves the computer. Only files
// directly inside the build folder are served, by exact name from an allowlist of extensions.
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'godotweb';
const ROOT = path.join(__dirname, '..', 'godot', 'build', 'web');
const TYPES = {
  '.js': 'text/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream',
  '.png': 'image/png', '.json': 'application/json',
};

// Pure: the file path for a request URL, or null if it is not an allowed file in `root`.
function resolveRequest(url, root = ROOT) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== 'app') return null;
  let name;
  try { name = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch { return null; } // bad %-encoding: 404, never a throw
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) return null;
  const type = TYPES[path.extname(name)];
  return type ? { file: path.join(root, name), type } : null;
}

function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
}

function handle(protocol, root = ROOT) {
  protocol.handle(SCHEME, (req) => {
    const r = resolveRequest(req.url, root);
    if (!r || !fs.existsSync(r.file)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(r.file), {
      headers: { 'Content-Type': r.type, 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' },
    });
  });
}

module.exports = { SCHEME, ROOT, resolveRequest, registerScheme, handle };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRequest } = require('../harness/godot-web');

const root = '/srv/build/web';

test('serves the build files by exact name with the right type', () => {
  assert.deepEqual(resolveRequest('godotweb://app/index.wasm', root), { file: '/srv/build/web/index.wasm', type: 'application/wasm' });
  assert.equal(resolveRequest('godotweb://app/index.js', root).type, 'text/javascript');
  assert.equal(resolveRequest('godotweb://app/index.pck', root).file, '/srv/build/web/index.pck');
});

test('refuses everything else: other hosts, schemes, paths, extensions, dotfiles', () => {
  for (const bad of ['godotweb://evil/index.js', 'https://app/index.js', 'file:///etc/passwd', 'godotweb://app/../../etc/passwd',
    'godotweb://app/%2e%2e%2fsecret.js', 'godotweb://app/sub/index.js', 'godotweb://app/index.html', 'godotweb://app/.env.js',
    'godotweb://app/', 'godotweb://app/x.exe', 'not a url']) {
    assert.equal(resolveRequest(bad, root), null, bad);
  }
});

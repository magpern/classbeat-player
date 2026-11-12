'use strict';
// The local link: 127.0.0.1 only, random port, a per-launch token. Loopback only, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const WebSocket = require('ws');
const { startLink, tokenOk } = require('../harness/godot-link');

const open = (url, opts) => new Promise((resolve) => {
  const ws = new WebSocket(url, opts);
  ws.on('open', () => resolve({ ok: true, ws }));
  ws.on('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode }));
  ws.on('error', () => resolve({ ok: false }));
});

test('token check is exact', () => {
  assert.equal(tokenOk('abc', 'Bearer abc'), true);
  for (const bad of [undefined, '', 'abc', 'Bearer', 'Bearer abd', 'Bearer abcd', 'bearer abc', 'Bearer abc extra']) assert.equal(tokenOk('abc', bad), false, String(bad));
});

test('accepts the right token, refuses missing, wrong and browser (Origin) clients, and only one client', async () => {
  const got = [];
  const link = await startLink({ onMessage: (m) => got.push(m) });
  try {
    assert.equal(link.host, '127.0.0.1');
    assert.match(link.token, /^[0-9a-f]{48}$/);
    const url = `ws://127.0.0.1:${link.port}/`;
    assert.equal((await open(url)).ok, false);
    assert.equal((await open(url, { headers: { Authorization: 'Bearer nope' } })).ok, false);
    assert.equal((await open(url, { headers: { Authorization: `Bearer ${link.token}`, Origin: 'http://evil.example' } })).ok, false);
    const good = await open(url, { headers: { Authorization: `Bearer ${link.token}` } });
    assert.equal(good.ok, true);
    assert.equal((await open(url, { headers: { Authorization: `Bearer ${link.token}` } })).ok, false, 'second client refused');
    good.ws.send('not json'); good.ws.send('[1]'); good.ws.send('5'); good.ws.send(JSON.stringify({ type: 'hb' }));
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(got, [{ type: 'hb' }]);
    const echoed = new Promise((r) => good.ws.once('message', (d) => r(JSON.parse(d.toString()))));
    link.send({ type: 'state', n: 1 });
    assert.deepEqual(await echoed, { type: 'state', n: 1 });
    good.ws.close();
  } finally { link.close(); }
});

test('listens on the loopback address only', async () => {
  const link = await startLink({ onMessage: () => {} });
  try {
    const other = Object.values(require('node:os').networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
    if (other) {
      const reached = await new Promise((resolve) => {
        const s = net.connect({ host: other.address, port: link.port }, () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
      });
      assert.equal(reached, false, `reachable on ${other.address}`);
    }
  } finally { link.close(); }
});

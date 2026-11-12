'use strict';
// The local link between the shell and the Godot program: a WebSocket server on 127.0.0.1 only,
// on a random port, that accepts one kind of client: one that sends this launch's random token in
// an Authorization header. Requests with an Origin header (a web page) are refused outright.
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const HOST = '127.0.0.1';

function tokenOk(expected, header) {
  const m = /^Bearer (\S+)$/.exec(header || '');
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// onMessage(obj) gets every valid JSON object the client sends; onConnect() when a client is accepted.
async function startLink({ onMessage, onConnect = () => {}, token = crypto.randomBytes(24).toString('hex') }) {
  let client = null;
  const wss = new WebSocketServer({
    host: HOST,
    port: 0,
    maxPayload: 64 * 1024,
    verifyClient: (info) => !info.origin && client === null && tokenOk(token, info.req.headers.authorization),
  });
  await new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  wss.on('connection', (ws) => {
    client = ws;
    ws.on('message', (data) => {
      let msg = null;
      try { msg = JSON.parse(data.toString('utf8')); } catch { /* ignore */ }
      if (msg && typeof msg === 'object' && !Array.isArray(msg)) onMessage(msg);
    });
    ws.on('close', () => { if (client === ws) client = null; });
    ws.on('error', () => {});
    onConnect();
  });
  return {
    port: wss.address().port,
    token,
    host: HOST,
    send(obj) { if (client && client.readyState === 1) client.send(JSON.stringify(obj)); },
    connected: () => client !== null,
    close() { for (const c of wss.clients) c.terminate(); wss.close(); },
  };
}

module.exports = { startLink, tokenOk, HOST };

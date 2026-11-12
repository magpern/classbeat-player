#!/usr/bin/env node
'use strict';
// A stand-in for the Godot program in end-to-end tests: speaks the same link protocol, draws nothing.
// FAKE_MODE: ok (default) keeps answering; silent stops sending after FAKE_AFTER_MS but stays alive and
// connected; die exits after FAKE_AFTER_MS. FAKE_OUT, if set, gets the number of state messages received.
const fs = require('node:fs');
const WebSocket = require('ws');

const mode = process.env.FAKE_MODE || 'ok';
const after = Number(process.env.FAKE_AFTER_MS || 1500);
const ws = new WebSocket(`ws://127.0.0.1:${process.env.SPIKE_LINK_PORT}/`, { headers: { Authorization: `Bearer ${process.env.SPIKE_LINK_TOKEN}` } });
let states = 0;
let timers = [];
const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

ws.on('open', () => {
  timers.push(setInterval(() => send({ type: 'hb', textH: { zone: 0.12, left: 0.3, cadence: 0.14, bpm: 0.14 } }), 500));
  timers.push(setInterval(() => send({ type: 'fps', v: 60 }), 1000));
  send({ type: 'hb', textH: { zone: 0.12, left: 0.3, cadence: 0.14, bpm: 0.14 } });
  if (mode === 'silent') setTimeout(() => { timers.forEach(clearInterval); timers = []; }, after);
  if (mode === 'die') setTimeout(() => process.exit(1), after);
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'state') {
    states += 1;
    if (process.env.FAKE_OUT) fs.writeFileSync(process.env.FAKE_OUT, String(states));
  } else if (m.type === 'capture' && mode === 'ok') send({ type: 'captured', name: 'fake.png' });
});
ws.on('close', () => process.exit(0));
ws.on('error', () => process.exit(2));

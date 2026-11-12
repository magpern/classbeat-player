'use strict';
// Pure validation of presenter commands arriving over IPC. Allowlist: anything else is null.
const MODES = ['scene', 'plain'];
const SIMPLE = ['toggle', 'reset', 'kill-scene'];

function parseCommand(cmd) {
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  if (SIMPLE.includes(cmd.type)) return { type: cmd.type };
  if (cmd.type === 'mode' && MODES.includes(cmd.mode)) return { type: 'mode', mode: cmd.mode };
  if (cmd.type === 'move-room' && Number.isInteger(cmd.n) && cmd.n >= 1 && cmd.n <= 9) return { type: 'move-room', n: cmd.n };
  return null;
}

module.exports = { parseCommand };

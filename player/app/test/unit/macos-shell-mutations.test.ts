// Each source check of macos-shell.test.ts (macos-checks.ts), shown to catch code that a "//" or "/*"
// in a string hides from `slashCode` (issue #861): the mutation applied to a real source file, the old
// view alone missing it. The checks only gain hits; the files they except are unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAC, raw } from "./macos-checks.ts";
import { type Mutation, mutationGaps, oldView, slashCode } from "./rule-sources.ts";

const MAIN = ["main/main.ts", 'import { app, BrowserWindow, ipcMain } from "electron";'] as const;
const MAC_READER = ["main/macos-reader.ts", 'import { execFile } from "node:child_process";'] as const;
const SPAWN = ["main/readers/windows-spawn.ts", 'import { spawn } from "node:child_process";'] as const;
const PAIR_SETUP = ["main/pairing/setup.ts", 'import { app, safeStorage, shell } from "electron";'] as const;
const PAIR_SERVICE = ["main/pairing/service.ts", 'import { INITIAL, step } from "../../core/pairing/machine.ts";'] as const;
const MACHINE = ["core/pairing/machine.ts", 'import type { OriginResult } from "./origin.ts";'] as const;
const UPDATE_SERVICE = ["main/update/service.ts", 'import { classChanged, NO_CLASS, statusArrived, visible } from "../../core/update/class-gate.ts";'] as const;
const SCRIPTS = ["core/link/macos-scripts.ts", 'export const OSASCRIPT = "/usr/bin/osascript";'] as const;
const TRANSPORT = ["core/link/transport.ts", 'export const TRANSPORT_ACTIONS = ["play", "pause", "next"] as const;'] as const;
const CHANNELS = ["core/channels.ts", 'export const CH_STATE = "player:state";'] as const;
const PRELOAD = ["preload/preload.ts", "  getState: (): Promise<unknown> => ipcRenderer.invoke(CH_STATE),"] as const;
const ROOM = ["preload/room-preload.ts", "  state: (): Promise<unknown> => ipcRenderer.invoke(CH_ROOM_STATE),"] as const;

type At = readonly [path: string, anchor: string];
// After a "//" in a string on the anchor's line: the old view drops the rest of the line.
const hidden = (check: keyof typeof MAC, [path, anchor]: At, after: string): Mutation => [check, path, anchor, `${anchor} const s = "//"; ${after}`, true];
// Between a "/*" and a "*/" in two strings: the old view drops the lines between them.
const spanned = (check: keyof typeof MAC, [path, anchor]: At, line: string): Mutation => [check, path, anchor, `${anchor}\nconst s = "/*";\n${line}\nconst t = "*/";`, true];

const MUTATIONS: readonly Mutation[] = [
  hidden("processes", MAIN, 'import { fork } from "node:child_process";'),
  hidden("execFileOnce", MAC_READER, "execFile(a, b, c);"),
  hidden("shellOnlyFalse", MAC_READER, 'run({ shell: "/bin/sh" });'),
  hidden("shells", MAIN, "exec(c);"),
  hidden("opens", MAIN, "void shell.openExternal(u);"),
  hidden("spawns", MAIN, "spawn(c);"),
  hidden("spawnOnce", SPAWN, "spawn(c);"),
  hidden("openOnce", PAIR_SETUP, "void shell.openExternal(u);"),
  hidden("pairingPages", PAIR_SERVICE, "d.openPage(other);"),
  hidden("openPageEffects", MACHINE, 'const e = { do: "open_page", page: other };'),
  hidden("releasePages", UPDATE_SERVICE, "deps.openPage(feed);"),
  hidden("addressCount", UPDATE_SERVICE, "const address = feed;"),
  hidden("releaseAddressCount", UPDATE_SERVICE, "releasePageAddress(x);"),
  hidden("scriptJoins", SCRIPTS, "const x = a.concat(b);"),
  hidden("namesOsascript", MAIN, 'const o = "osascript";'),
  hidden("tells", MAIN, 'const e = "tell application";'),
  hidden("buildsMac", MAIN, "createMacMusic();"),
  hidden("importsMac", PAIR_SETUP, 'import { m } from "../macos-reader.ts";'),
  spanned("exposed", PRELOAD, "  steal: () => 1,"),
  // In single quotes, so the old view keeps its double quotes paired.
  ["channels", CHANNELS[0], CHANNELS[1], `${CHANNELS[1]} const s = '//'; export const CH_X = "x:steal";`, true],
  spanned("roomExposed", ROOM, "  steal: () => 1,"),
  spanned("roomArguments", ROOM, "  start: (x: unknown) => 1,"),
  hidden("roomIpcCalls", ROOM, 'ipcRenderer.send("x");'),
  hidden("readerSecrets", MAC_READER, "fetch(u);"),
  hidden("readerSecrets", TRANSPORT, "const t = process.env.X;"),
];

test('every source check of the macOS shell catches code a "//" or "/*" in a string hides from the old view', () => {
  assert.deepEqual(mutationGaps(MUTATIONS, new Map(Object.entries(MAC)), raw, oldView(slashCode)), []);
  assert.deepEqual([...new Set(MUTATIONS.map(([c]) => c))].sort(), Object.keys(MAC).sort());
});

// The source checks of macos-shell.test.ts: what may start a process or open anything, the scripts,
// the reader's builders, and the two preload bridges. Each reads two views (rule-sources.ts, issue
// #861): `slashCode`, as before, and the file with only its real comments out, so a "//" or "/*" in a
// string hides nothing from it. The pins that a line must be there stay on `slashCode` alone.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { APP_SRC, type Check, differs, forbids, slashCode } from "./rule-sources.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
export const sources = files(APP_SRC).map((p) => ({ path: relative(APP_SRC, p).split(sep).join("/"), text: readFileSync(p, "utf8") }));
export const raw = (path: string): string => sources.find((s) => s.path === path)?.text ?? assert.fail(`missing ${path}`);
/** The sources a check hits, sorted. */
export const holders = (check: Check): string[] => sources.filter((s) => check(s.path, s.text)).map((s) => s.path).sort();

// The Windows helper (#42) is the one process not run with execFile, started in
// main/readers/windows-spawn.ts; test/unit/windows-script.test.ts pins how.
export const WINDOWS_SPAWN = "main/readers/windows-spawn.ts";
export const EXEC_READERS = ["main/linux-reader.ts", "main/macos-reader.ts"];
// The places that open anything in the system: the pairing page in the browser (#74), and the newer
// version's release page (#798, ADR 0014 section 2), each checked by its own test.
export const OPENS_PAGE = "main/pairing/setup.ts";
export const OPENS_RELEASE = "main/update/setup.ts";

const count = (re: RegExp) => (v: string): number => v.match(re)?.length ?? 0;
const once = (re: RegExp): Check => differs(count(re), 1, slashCode);
const groups = (re: RegExp) => (v: string): (string | undefined)[] => [...v.matchAll(re)].map((m) => m[1]);
const names = groups(/^ {2}(\w+):/gm);

export const EXPOSED = ["getState", "command", "openDropped", "onUpdate", "startPairing", "pairingState", "reopenPairingPage", "unpair", "listView", "startClass", "openClassFile", "dismissFileError", "backToClass", "mixSignIn", "mixSignOut", "findMusicFiles", "cancelMusicFilesFind", "liveView", "startLive", "endLive", "makeControlCode", "dropPhone", "riders", "dropRider", "lockJoining", "newJoinCode", "updateStatus", "checkForUpdate", "openReleasePage", "setAutomaticChecks", "setPrereleases"];
const CHANNELS = ["player:state", "player:command", "player:open-dropped", "player:update", "player:pairing-start", "player:pairing-state", "player:unpair", "player:pairing-reopen", "list:view", "list:start", "list:open-file", "list:dismiss-error", "list:back", "player:mix-sign-in", "player:mix-sign-out", "room:state", "room:update", "room:command", "room:end", "room:remote-state", "room:remote-start", "room:remote-stop", "room:remote-update", "room:mix", "room:mix-report", "room:local", "room:local-report", "live:view", "live:start", "live:end", "live:code", "live:drop", "live:riders", "live:drop-rider", "live:lock", "live:new-code", "update:status", "update:check", "update:open-release", "update:set-auto", "update:set-prereleases", "player:music-files-find", "player:music-files-find-cancel"];
export const ROOM_EXPOSED = ["state", "onUpdate", "start", "pause", "resume", "previous", "next", "forward", "back", "undo", "follow", "endClass", "remoteState", "startRemote", "stopRemote", "onRemote", "onMix", "mixReport", "onLocal", "localReport"];

/** Each check by name; a check hits a file that breaks it in any view. */
export const MAC = {
  // Only the readers and the Windows helper name child_process (an allowlist, by `holders`).
  processes: forbids(/child_process/, slashCode),
  execFileOnce: once(/\bexecFile\(/g),
  shellOnlyFalse: differs((v) => count(/\bshell:/g)(v) - count(/\bshell: false\b/g)(v), 0, slashCode),
  shells: forbids(/\b(exec|execSync|execFileSync|spawnSync|fork)\(|shell:\s*true|\bopenPath\b/, slashCode),
  opens: forbids(/\bopenExternal\b/, slashCode),
  spawns: forbids(/\bspawn\(/, slashCode),
  spawnOnce: once(/\bspawn\(/g),
  openOnce: once(/\bopenExternal\b/g),
  pairingPages: differs(groups(/\bd\.openPage\(([^)]*)\)/g), ["e.page", "state.page"], slashCode),
  openPageEffects: differs(groups(/do: "open_page", page: ([\w.]+)/g), ["answer.page"], slashCode),
  releasePages: differs(groups(/\bdeps\.openPage\(([^)]*)\)/g), ["address"], slashCode),
  addressCount: differs(count(/\baddress\b/g), 4, slashCode),
  releaseAddressCount: differs(count(/\breleasePageAddress\b/g), 2, slashCode),
  scriptJoins: forbids(/`|\$\{|\+|\.concat\(|\.replace\(|\.join\(/, slashCode),
  namesOsascript: forbids(/osascript"/, slashCode),
  tells: forbids(/tell application|-e"/, slashCode),
  buildsMac: forbids(/\bcreateMacMusic\b/, slashCode),
  importsMac: forbids(/macos-reader|select-music/, slashCode),
  exposed: differs(names, EXPOSED, slashCode),
  channels: differs(groups(/"([^"]+)"/g), CHANNELS, slashCode),
  roomExposed: differs(names, ROOM_EXPOSED, slashCode),
  roomArguments: differs((v) => names(v).filter((n) => new RegExp(`^ {2}${n}: \\((?!\\)|cb: )`, "m").test(v)), ["mixReport", "localReport"], slashCode),
  roomIpcCalls: differs((v) => count(/ipcRenderer\./g)(v) - names(v).length, 0, slashCode),
  readerSecrets: forbids(/token|oauth|client.?id|bearer|authoriz|https?:|fetch\(|node:net|node:http|node:dns|node:fs|process\.env/i, slashCode),
} satisfies Record<string, Check>;

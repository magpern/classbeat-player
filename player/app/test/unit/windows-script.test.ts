// The Windows helper is exactly one fixed script, started without a shell from a full path with a
// constant argument list. These tests pin the script and the way it is started; a change to
// either has to change this file too. Nothing here starts a process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TRANSPORT_ACTIONS } from "../../src/core/link/transport.ts";
import { spawnWindowsHelper } from "../../src/main/readers/windows-spawn.ts";
import type { HelperSpawnOptions, RawChild } from "../../src/main/readers/windows-spawn.ts";
import { HELPER_CALL_TIMEOUT_MS, HELPER_POLL_MS, powershellPath, systemRoot, WINDOWS_HELPER_ARGS, WINDOWS_HELPER_ENCODED, WINDOWS_HELPER_SCRIPT as SCRIPT } from "../../src/main/readers/windows-script.ts";
import { REPO } from "./fixtures.ts";

const SRC = join(REPO, "player", "app", "src");
const READERS = join(SRC, "main", "readers");
const source = (name: string): string => readFileSync(join(READERS, name), "utf8");

test("the helper script is exactly the pinned one", () => {
  assert.equal(createHash("sha256").update(SCRIPT, "utf8").digest("hex"), "0bb5430babe0803ae1cd684d211a67417fb7b6da92ed37ebe35bca77a73f1855");
  assert.equal(SCRIPT.split("\n").length, 51);
});

test("the script is a constant: nothing is interpolated into it", () => {
  const text = source("windows-script.ts");
  assert.doesNotMatch(text, /\$\{/, "no template placeholder anywhere in the module");
  assert.match(text, /export const WINDOWS_HELPER_SCRIPT = `\$ErrorActionPreference = 'Stop'\n/);
  assert.doesNotMatch(SCRIPT, /\$\(|\$args\b|\$env:|\$input\b/i, "no subexpression, argument, environment or pipeline input");
});

test("the script uses only these commands", () => {
  const cmdlets = new Set(SCRIPT.match(/\b[A-Za-z]+-[A-Za-z]+\b/g));
  assert.deepEqual([...cmdlets].sort(), ["Add-Type", "ConvertTo-Json", "New-Object", "Out-Null", "Select-Object", "Start-Sleep", "Where-Object"]);
  // The only types it names: the console (for its two standard streams), a reader and a writer
  // for them, the system's own async bridge, a date, and the two media session types.
  const types = new Set([...SCRIPT.matchAll(/\[([A-Za-z][\w.]*)[\],]/g)].map((m) => m[1]));
  assert.deepEqual([...types].sort(), [
    "Console",
    "DateTimeOffset",
    "System.IO.StreamReader",
    "System.IO.StreamWriter",
    "System.WindowsRuntimeSystemExtensions",
    "Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager",
    "Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties",
    "bool",
    "int64",
    "ordered",
  ]);
  assert.match(SCRIPT, /New-Object System\.Text\.UTF8Encoding \$false/);
  assert.deepEqual(SCRIPT.match(/\[Console\]::\w+/g), ["[Console]::OpenStandardInput", "[Console]::OpenStandardOutput"]);
  assert.equal(SCRIPT.match(/New-Object/g)?.length, 1);
  assert.equal(SCRIPT.match(/Add-Type/g)?.length, 1);
  assert.match(SCRIPT, /Add-Type -AssemblyName System\.Runtime\.WindowsRuntime\n/, "an assembly of the system, never source code");
});

test("the script only reads the Spotify session, and its only controls are play, pause and next", () => {
  assert.equal(SCRIPT.match(/SourceAppUserModelId -like 'Spotify\*'/g)?.length, 1);
  assert.doesNotMatch(SCRIPT, /GetCurrentSession/, "never whichever session is current");
  const calls = [...SCRIPT.matchAll(/[.:](Try\w+|Request\w+|Get\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(calls, ["GetMethods", "GetParameters", "GetParameters", "GetPlaybackInfo", "GetSessions", "GetTimelineProperties", "RequestAsync", "TryGetMediaPropertiesAsync", "TryPauseAsync", "TryPlayAsync", "TrySkipNextAsync"]);
  const names = [...SCRIPT.matchAll(/\$command -ceq '([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(names, [...TRANSPORT_ACTIONS], "input lines are compared, case and all, with the three names");
  assert.equal(SCRIPT.match(/\$command\b/g)?.length, 4, "and used for nothing else");
  assert.doesNotMatch(SCRIPT, /Invoke-|iex\b|Start-Process|\bNet\b|Web|http|Download|Registry|Out-File|Set-Content|Remove-/i);
});

test("the script's fixed poll interval and call timeout", () => {
  assert.equal(HELPER_POLL_MS, 250);
  assert.equal(HELPER_CALL_TIMEOUT_MS, 2000);
  assert.deepEqual(SCRIPT.match(/Start-Sleep -Milliseconds \d+/g), [`Start-Sleep -Milliseconds ${HELPER_POLL_MS}`]);
  assert.deepEqual(SCRIPT.match(/\.Wait\([^)]*\)/g), [`.Wait(${HELPER_CALL_TIMEOUT_MS})`]);
  assert.match(SCRIPT, /if \(\$null -eq \$pending\.Result\) \{ exit 0 \}/, "it ends when its input closes, so it never outlives the application");
});

test("the argument list is constant and carries exactly the script", () => {
  assert.deepEqual(WINDOWS_HELPER_ARGS, ["-NoLogo", "-NoProfile", "-NonInteractive", "-InputFormat", "None", "-EncodedCommand", WINDOWS_HELPER_ENCODED]);
  assert.equal(Buffer.from(WINDOWS_HELPER_ENCODED, "base64").toString("utf16le"), SCRIPT);
  assert.equal(Object.isFrozen(WINDOWS_HELPER_ARGS), true);
});

test("PowerShell is started by its full path under the Windows directory", () => {
  assert.equal(powershellPath({ SystemRoot: "C:\\Windows" }), "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(powershellPath({ SYSTEMROOT: "D:\\WINNT" }), "D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  for (const bad of [undefined, "", "Windows", "\\\\server\\share\\Windows", "C:\\Windows\\..\\Evil", "C:/Windows", 'C:\\Win"dows', "C:\\Windows\nD:\\x", ".\\Windows"]) {
    assert.equal(systemRoot({ SystemRoot: bad }), "C:\\Windows", String(bad));
  }
});

class FakeStream extends EventEmitter {
  readonly written: string[] = [];
  encoding: string | null = null;
  setEncoding(e: string): void {
    this.encoding = e;
  }
  write(text: string): void {
    this.written.push(text);
  }
}

class FakeProcess extends EventEmitter {
  readonly stdout = new FakeStream();
  readonly stdin = new FakeStream();
  kills = 0;
  kill(): void {
    this.kills += 1;
  }
}

function started(): { calls: { file: string; args: readonly string[]; options: HelperSpawnOptions }[]; proc: FakeProcess; child: ReturnType<typeof spawnWindowsHelper> } {
  const calls: { file: string; args: readonly string[]; options: HelperSpawnOptions }[] = [];
  const proc = new FakeProcess();
  const child = spawnWindowsHelper({ SystemRoot: "C:\\Windows" }, (file, args, options) => {
    calls.push({ file, args, options });
    return proc as unknown as RawChild;
  });
  return { calls, proc, child };
}

test("the helper is started once, without a shell, with the constant arguments", () => {
  const { calls, proc } = started();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(calls[0].args, WINDOWS_HELPER_ARGS, "the very same constant list");
  assert.deepEqual(calls[0].options, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], cwd: "C:\\Windows" });
  assert.equal(proc.stdout.encoding, "utf8");
});

test("a started helper cannot throw into the application", () => {
  const { proc, child } = started();
  const chunks: string[] = [];
  let exits = 0;
  child.onStdout((c) => chunks.push(c));
  child.onExit(() => (exits += 1));
  proc.stdout.emit("data", "a line\n");
  proc.stdout.emit("data", Buffer.from("not text"));
  assert.deepEqual(chunks, ["a line\n"]);
  assert.doesNotThrow(() => proc.stdout.emit("error", new Error("read")));
  assert.doesNotThrow(() => proc.stdin.emit("error", new Error("EPIPE")));
  assert.doesNotThrow(() => proc.emit("error", new Error("ENOENT")));
  proc.emit("exit", 1, null);
  assert.equal(exits, 2, "a failed start and an exit both count as the helper ending");
  proc.stdin.write = () => {
    throw new Error("write after end");
  };
  proc.kill = () => {
    throw new Error("already gone");
  };
  assert.doesNotThrow(() => child.write("next\n"));
  assert.doesNotThrow(() => child.kill());
});

test("the Windows helper is started only in windows-spawn.ts, and nothing starts a process through a shell", () => {
  const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]));
  const files = all(SRC).map((p) => ({ path: p.slice(SRC.length + 1).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
  const starters = files.filter((f) => /child_process|\bworker_threads\b|\bcluster\b/.test(f.text)).map((f) => f.path);
  // The macOS reader (#41) runs osascript; the Windows helper is the only other process.
  assert.deepEqual(starters.sort(), ["main/macos-reader.ts", "main/readers/windows-spawn.ts"]);
  const namers = files.filter((f) => /powershell\.exe|WINDOWS_HELPER_(ARGS|ENCODED|SCRIPT)/i.test(f.text)).map((f) => f.path);
  assert.deepEqual(namers.sort(), ["main/readers/windows-script.ts", "main/readers/windows-spawn.ts"]);
  const spawn = source("windows-spawn.ts");
  assert.match(spawn, /import \{ spawn \} from "node:child_process";/, "spawn only: not exec, execFile with a shell, or fork");
  assert.doesNotMatch(spawn, /shell: true|\bexec\w*\(|\bfork\(/);
  assert.equal(spawn.match(/\bspawn\(/g)?.length, 1);
  for (const f of files) assert.doesNotMatch(f.text, /shell: true|\bexecSync\b|\bshell\.openExternal\b|\bopenPath\b/, f.path);
});

test("the parser, the supervisor and the reader do no I/O of their own", () => {
  for (const name of ["windows-parse.ts", "helper-supervisor.ts", "windows-reader.ts"]) {
    assert.doesNotMatch(source(name), /from\s+["'](node:[\w/]+|electron|fs|child_process)["']|\bprocess\.|\bsetTimeout\b|\bDate\.now\b/, name);
  }
  assert.deepEqual(source("windows-script.ts").match(/from\s+["'][^"']+["']/g), ['from "node:path"'], "the script module only joins a path");
});

test("the reader holds no token and reaches no network", () => {
  for (const name of readdirSync(READERS)) {
    assert.doesNotMatch(source(name), /access[_-]?token|client[_-]?secret|api[_-]?key|password|authorization|bearer|oauth/i, name);
    assert.doesNotMatch(source(name), /https?:|node:(net|http|https|tls|dgram|dns)\b|\bfetch\(/, name);
  }
});

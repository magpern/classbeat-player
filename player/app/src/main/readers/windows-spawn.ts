// Starts the Windows helper process: the only place in the application that does.
// No shell, a full path to Windows PowerShell, and a constant argument list (windows-script.ts);
// nothing from a class file, the presenter or the music app is ever part of the command.
//
// `spawn` and not `execFile`: both start the program directly without a shell, but `execFile`
// collects all output in memory until the process ends, and this helper stays alive.
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { HelperChild, SupervisorDeps } from "./helper-supervisor.ts";
import { powershellPath, systemRoot, WINDOWS_HELPER_ARGS } from "./windows-script.ts";

export interface HelperSpawnOptions {
  readonly shell: false;
  readonly windowsHide: true;
  /** Input for the three command names, output for the readings, errors discarded. */
  readonly stdio: ["pipe", "pipe", "ignore"];
  readonly cwd: string;
}

interface Emitter {
  on(event: string, cb: (...args: never[]) => void): unknown;
}

/** The part of a Node child process the helper uses. */
export interface RawChild extends Emitter {
  readonly stdout: (Emitter & { setEncoding(encoding: "utf8"): unknown }) | null;
  readonly stdin: (Emitter & { write(text: string): unknown }) | null;
  kill(): unknown;
}

export type SpawnFn = (file: string, args: readonly string[], options: HelperSpawnOptions) => RawChild;

const nodeSpawn: SpawnFn = (file, args, options) => spawn(file, [...args], { ...options });

const quietly = (fn: () => unknown): void => {
  try {
    fn();
  } catch {
    // A helper that is already gone cannot be written to or killed; that is fine.
  }
};

export function spawnWindowsHelper(env: Readonly<Record<string, string | undefined>>, spawnFn: SpawnFn = nodeSpawn): HelperChild {
  const child = spawnFn(powershellPath(env), WINDOWS_HELPER_ARGS, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], cwd: systemRoot(env) });
  // An error event without a listener would end the application; the exit handler does the rest.
  child.stdout?.on("error", () => undefined);
  child.stdin?.on("error", () => undefined);
  child.stdout?.setEncoding("utf8");
  return {
    onStdout(cb) {
      child.stdout?.on("data", (chunk: unknown) => {
        if (typeof chunk === "string") cb(chunk);
      });
    },
    onExit(cb) {
      child.on("exit", () => cb());
      child.on("error", () => cb());
    },
    write(text) {
      quietly(() => child.stdin?.write(text));
    },
    kill() {
      quietly(() => child.kill());
    },
  };
}

/** The real dependencies. `now` must be the clock the controller uses, so readings share its time. */
export function windowsHelperDeps(now: () => number = () => performance.now(), env: Readonly<Record<string, string | undefined>> = process.env): SupervisorDeps {
  return {
    spawn: () => spawnWindowsHelper(env),
    now,
    setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  };
}

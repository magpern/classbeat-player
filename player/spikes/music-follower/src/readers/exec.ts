import { execFile } from "node:child_process";

/** Run a local command without a shell. Resolves with stdout, or null on any failure or timeout. */
export function runCommand(file: string, args: string[], timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** A command runner; tests pass a fake so the real osascript is never called. */
export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>;

/**
 * Like runCommand, but keeps stderr and says whether the command timed out. The deadline is our
 * own: the promise settles at the deadline even if the child ignores SIGTERM (osascript blocked on
 * an Apple Event can), and the child is then killed with SIGKILL.
 */
export const runCommandDetailed: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    let done = false;
    const settle = (r: ExecResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => {
      settle({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut: false });
    });
    const timer = setTimeout(() => {
      settle({ ok: false, stdout: "", stderr: "", timedOut: true });
      child.kill("SIGKILL");
    }, timeoutMs);
  });

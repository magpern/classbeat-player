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

/** Like runCommand, but keeps stderr and says whether the command was killed by the timeout. */
export const runCommandDetailed: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), timedOut: !!err && (err as { killed?: boolean }).killed === true });
    });
  });

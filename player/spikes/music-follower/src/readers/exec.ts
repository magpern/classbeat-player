import { execFile } from "node:child_process";

/** Run a local command without a shell. Resolves with stdout, or null on any failure or timeout. */
export function runCommand(file: string, args: string[], timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

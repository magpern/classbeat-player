import { LinuxReader } from "./linux.js";
import { MacReader } from "./macos.js";
import type { Reader } from "./reader.js";
import { WindowsReader } from "./windows.js";

const BY_PLATFORM: Record<string, string> = { darwin: "macos", win32: "windows", linux: "linux" };

export function createReader(kind: string, pollMs: number, note?: (text: string) => void): Reader {
  const k = kind === "auto" ? (BY_PLATFORM[process.platform] ?? "") : kind;
  if (k === "macos") return new MacReader(undefined, note);
  if (k === "windows") return new WindowsReader(pollMs);
  if (k === "linux") return new LinuxReader();
  throw new Error(`no reader for "${kind}" on ${process.platform} (use --reader macos|windows|linux)`);
}

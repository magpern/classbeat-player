// Which reader the shell uses on this system (ADR 0001: one module per follower). A platform
// without a reader of its own gets the manual reader, and no other platform's factory is called,
// so a system never constructs a reader that is not its own.
import { manualReader } from "../../core/link/reader.ts";
import type { ShellReader } from "./shell-reader.ts";
import { createWindowsReader } from "./windows-reader.ts";
import { windowsHelperDeps } from "./windows-spawn.ts";

export type ReaderFactories = Partial<Record<NodeJS.Platform, () => ShellReader>>;

export const READER_FACTORIES: ReaderFactories = {
  win32: () => createWindowsReader(windowsHelperDeps()),
};

export function selectReader(platform: NodeJS.Platform, factories: ReaderFactories = READER_FACTORIES): ShellReader {
  const make = Object.hasOwn(factories, platform) ? factories[platform] : undefined;
  return make ? make() : manualReader;
}

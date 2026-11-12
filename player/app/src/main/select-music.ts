// Which follower the shell uses, by platform (ADR 0001: "One interface, one module per
// follower"). macOS, Windows and Linux each have one; everywhere else the clock is manual. A
// system never constructs a follower that is not its own.
import { manualReader } from "../core/link/reader.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport } from "../core/link/transport.ts";
import { createLinuxMusic } from "./linux-reader.ts";
import { createMacMusic } from "./macos-reader.ts";
import { createWindowsMusic } from "./readers/windows-reader.ts";

export interface Music {
  readonly reader: MusicReader;
  readonly transport: MusicTransport | null;
}

type Make = () => MusicReader & MusicTransport;

export function selectMusic(platform: string, makeMac: Make = createMacMusic, makeWindows: Make = createWindowsMusic, makeLinux: Make = createLinuxMusic): Music {
  const make = platform === "darwin" ? makeMac : platform === "win32" ? makeWindows : platform === "linux" ? makeLinux : null;
  if (make === null) return { reader: manualReader, transport: null };
  const music = make();
  return { reader: music, transport: music };
}

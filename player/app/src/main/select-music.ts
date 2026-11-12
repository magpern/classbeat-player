// Which follower the shell uses, by platform (ADR 0001: "One interface, one module per
// follower"). macOS and Linux have one so far; everywhere else the clock is manual and no
// follower is ever constructed.
import { manualReader } from "../core/link/reader.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport } from "../core/link/transport.ts";
import { createLinuxMusic } from "./linux-reader.ts";
import { createMacMusic } from "./macos-reader.ts";

export interface Music {
  readonly reader: MusicReader;
  readonly transport: MusicTransport | null;
}

type Make = () => MusicReader & MusicTransport;

export function selectMusic(platform: string, makeMac: Make = createMacMusic, makeLinux: Make = createLinuxMusic): Music {
  const make = platform === "darwin" ? makeMac : platform === "linux" ? makeLinux : null;
  if (make === null) return { reader: manualReader, transport: null };
  const follower = make();
  return { reader: follower, transport: follower };
}

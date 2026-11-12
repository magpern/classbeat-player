// Which follower the shell uses, by platform (ADR 0001: "One interface, one module per
// follower"). Only macOS has one so far; everywhere else the clock is manual and no follower is
// ever constructed.
import { manualReader } from "../core/link/reader.ts";
import type { MusicReader } from "../core/link/reader.ts";
import type { MusicTransport } from "../core/link/transport.ts";
import { createMacMusic } from "./macos-reader.ts";

export interface Music {
  readonly reader: MusicReader;
  readonly transport: MusicTransport | null;
}

export function selectMusic(platform: string, makeMac: () => MusicReader & MusicTransport = createMacMusic): Music {
  if (platform !== "darwin") return { reader: manualReader, transport: null };
  const mac = makeMac();
  return { reader: mac, transport: mac };
}

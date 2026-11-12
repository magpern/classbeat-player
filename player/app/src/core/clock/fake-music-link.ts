// A fake music link for tests: readings are pushed by hand. Pure, no I/O.
import type { MusicLink, MusicReading } from "./music-link.ts";

export interface FakeMusicLink extends MusicLink {
  push(reading: MusicReading): void;
  clear(): void;
}

export function createFakeMusicLink(): FakeMusicLink {
  let last: MusicReading | null = null;
  return {
    kind: "fake",
    latest: () => last,
    push: (r) => {
      last = r;
    },
    clear: () => {
      last = null;
    },
  };
}

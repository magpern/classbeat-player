// A rig for local music file finding on real temporary folders (#920): a class with local files,
// a music folder, the app data folder with the index store, and a fake folder dialog. No network.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_DIR, indexStore } from "../../src/main/music-files/index-store.ts";
import { createMusicFiles } from "../../src/main/music-files/service.ts";
import type { MusicFiles } from "../../src/main/music-files/service.ts";

export const CLASS_ID = "6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f";
export const ACCT = "c".repeat(64);
export const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** A song's file content: `n` bytes made from `seed`, so two seeds never share a hash. */
export const bytes = (seed: string, n: number): Buffer => Buffer.alloc(n, seed);

export const localClass = (files: readonly Buffer[], names: readonly string[] = files.map((_, i) => `song-${i}.mp3`)) => ({
  format_version: "1.4",
  music: { source: "local" },
  songs: files.map((b, i) => ({ title: `Song ${i}`, ids: { local_file: { sha256: sha(b), size_bytes: b.length, file_name: names[i] } } })),
});

export interface Rig {
  readonly root: string;
  readonly music: string;
  readonly data: string;
  readonly indexDir: string;
  readonly service: MusicFiles;
  doc: unknown;
  account: string | null;
  /** The folder the fake dialog answers; null is a dialog closed without a choice. */
  folder: string | null;
  /** When set, the dialog waits for this before answering. */
  dialogGate: Promise<void> | null;
  dialogs: number;
  put(rel: string, b: Buffer): string;
  done(): void;
}

export function musicRig(maxFiles?: number): Rig {
  const root = mkdtempSync(join(tmpdir(), "cbp-music-"));
  const music = join(root, "Music");
  const data = join(root, "data");
  mkdirSync(music);
  mkdirSync(data);
  const indexDir = join(data, INDEX_DIR);
  const rig: Rig = {
    root,
    music,
    data,
    indexDir,
    doc: null,
    account: ACCT,
    folder: music,
    dialogGate: null,
    dialogs: 0,
    service: null as unknown as MusicFiles,
    put(rel, b) {
      const p = join(music, rel);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, b);
      return p;
    },
    done: () => rmSync(root, { recursive: true, force: true }),
  };
  (rig as { service: MusicFiles }).service = createMusicFiles({
    account: () => rig.account,
    classDocument: (id) => (id === CLASS_ID ? rig.doc : null),
    pickFolder: async () => {
      rig.dialogs += 1;
      if (rig.dialogGate !== null) await rig.dialogGate;
      return rig.folder;
    },
    store: indexStore(indexDir),
    maxFiles,
  });
  return rig;
}

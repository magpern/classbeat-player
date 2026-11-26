// Rule 3 for the index side (plan section 3; ADR 0017 section 5; #920): an audio file the
// instructor keeps on their own device never leaves it, and nothing of the disk (a path, a folder
// or a file name) reaches a page, an IPC answer, a log or an error. The planted-pattern test runs
// a real find with the network guard on; the import guard keeps the modules that hold paths in the
// main process, apart from every module that sends anything off the device.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, it, test } from "node:test";
import type { IpcMainInvokeEvent } from "electron";
import { CH_MUSIC_FILES_FIND, CH_MUSIC_FILES_FIND_CANCEL } from "../../src/core/channels.ts";
import type { IpcBus } from "../../src/main/ipc-handlers.ts";
import { registerMusicFilesHandlers } from "../../src/main/music-files/handlers.ts";
import { createMusicFiles } from "../../src/main/music-files/service.ts";
import { indexStore } from "../../src/main/music-files/index-store.ts";
import { REPO } from "./fixtures.ts";
import { closure, graphOf } from "./import-graph.ts";
import type { Files } from "./import-graph.ts";
import { ACCT, CLASS_ID, localClass, musicRig } from "./music-files-fakes.ts";
import type { Rig } from "./music-files-fakes.ts";

const FOLDER = "SENTINEL-folder-4c1e";
const FILE = "SENTINEL-file-9b2d.mp3";
const PATTERN = Buffer.from("SENTINEL-bytes-0f7a-");
const TRUSTED = { presenterId: 7, presenterUrl: "file:///app/dist/presenter.html", listUrl: "file:///app/dist/classlist.html" };
const fromList = { sender: { id: 7 }, senderFrame: { parent: null, url: TRUSTED.listUrl } } as unknown as IpcMainInvokeEvent;

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

describe("the planted pattern", () => {
  let r: Rig;
  const said: string[] = [];
  const restore: Array<() => void> = [];
  beforeEach(() => {
    r = musicRig();
    said.length = 0;
    for (const k of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      const was = console[k];
      console[k] = (...a: unknown[]) => void said.push(a.map(String).join(" "));
      restore.push(() => (console[k] = was));
    }
    for (const s of [process.stdout, process.stderr]) {
      const was = s.write.bind(s);
      s.write = ((chunk: unknown, ...rest: unknown[]) => (said.push(String(chunk)), (was as (...a: unknown[]) => boolean)(chunk, ...rest))) as typeof s.write;
      restore.push(() => (s.write = was));
    }
  });
  afterEach(() => {
    while (restore.length > 0) restore.pop()!();
    r.done();
  });

  const leaks = (text: string): string[] => [FOLDER, FILE, PATTERN.toString(), r.music, r.root].filter((s) => text.includes(s));

  it("reaches no IPC answer, log line or stored file other than the index", async () => {
    const song = Buffer.concat([PATTERN, Buffer.alloc(3000, 1), PATTERN]);
    const other = Buffer.concat([PATTERN, Buffer.alloc(100, 2)]);
    r.doc = localClass([song, other]);
    r.put(join(FOLDER, FILE), song);
    r.put(join(FOLDER, "deeper", FILE), Buffer.concat([PATTERN, Buffer.alloc(3000, 9), PATTERN]));
    r.folder = join(r.music, FOLDER);
    const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
    const bus: IpcBus = { handle: (ch, fn) => void handlers.set(ch, fn) };
    registerMusicFilesHandlers(bus, () => TRUSTED, r.service);
    const answers = [await handlers.get(CH_MUSIC_FILES_FIND)!(fromList, CLASS_ID), await handlers.get(CH_MUSIC_FILES_FIND_CANCEL)!(fromList, undefined), await r.service.check(CLASS_ID)];
    assert.deepEqual(answers[0], { status: "done", songs: ["found", "missing"], limit_reached: false });
    for (const a of answers) assert.deepEqual(leaks(JSON.stringify(a)), []);
    assert.deepEqual(leaks(said.join("\n")), []);
    // The index is the one place the path is kept; every other file of the app data holds none of it.
    const files = walk(r.data);
    const index = join(r.indexDir, `${ACCT}.json`);
    assert.ok(files.includes(index));
    assert.ok(readFileSync(index, "utf8").includes(FOLDER), "the index does hold the path, so the check above can fail");
    for (const f of files.filter((f) => f !== index)) assert.deepEqual(leaks(readFileSync(f, "latin1")), [], relative(r.root, f));
    for (const f of files) assert.ok(!readFileSync(f).includes(PATTERN), "no file's bytes are copied into the app data");
  });

  it("a fault answers the fixed `failed`, never the error that names the disk, and logs nothing", async () => {
    r.doc = localClass([Buffer.alloc(10)]);
    const music = createMusicFiles({
      account: () => ACCT,
      classDocument: () => r.doc,
      pickFolder: async () => join(r.music, FOLDER),
      store: {
        ...indexStore(r.indexDir),
        load: () => {
          throw new Error(`EACCES: ${join(r.music, FOLDER, FILE)}`);
        },
      },
    });
    const handlers = new Map<string, (e: IpcMainInvokeEvent, raw: unknown) => unknown>();
    registerMusicFilesHandlers({ handle: (ch, fn) => void handlers.set(ch, fn) }, () => TRUSTED, music);
    const answer = await handlers.get(CH_MUSIC_FILES_FIND)!(fromList, CLASS_ID);
    assert.deepEqual(answer, { status: "failed" });
    // The test runner itself may report on stdout (it does under CI's child-process runner), so the
    // check is on what a log line would carry: nothing of the disk and nothing of the error.
    const text = said.join("\n");
    assert.deepEqual(leaks(text), []);
    assert.ok(!text.includes("EACCES"), "the error is not logged");
  });
});

describe("the modules that hold a path", () => {
  const src = join(REPO, "player", "app", "src");
  const all = walk(src).filter((p) => p.endsWith(".ts"));
  const files: Files = new Map(all.map((p) => [relative(REPO, p).split("\\").join("/"), readFileSync(p, "utf8")]));
  const graph = graphOf(files);
  const HOLDS = /\/src\/(main\/music-files\/[^/]+|core\/music-files\/index-model)\.ts$/;
  const SENDS = /\/src\/main\/(live|sync|pairing|update|mix|room)\/|\/src\/main\/(ipc|ipc-handlers)\.ts$/;

  it("are out of reach of every renderer, the preloads and the scene", () => {
    const pages = [...files.keys()].filter((p) => /\/src\/(preload|renderer|scene)\//.test(p));
    assert.ok(pages.length > 2);
    assert.deepEqual([...closure(graph, pages)].filter((p) => HOLDS.test(p)), []);
  });

  it("are loaded only from main.ts and each other", () => {
    const holders = [...files.keys()].filter((p) => HOLDS.test(p));
    assert.ok(holders.length >= 8);
    const outside = [...graph].filter(([p, deps]) => !HOLDS.test(p) && !p.endsWith("/src/main/main.ts") && deps.some((q) => HOLDS.test(q))).map(([p]) => p);
    assert.deepEqual(outside, []);
  });

  it("reach no module that sends anything off the device, nor any that writes a log", () => {
    const holders = [...files.keys()].filter((p) => HOLDS.test(p));
    const reached = [...closure(graph, holders)];
    assert.deepEqual(reached.filter((p) => SENDS.test(p) && !p.endsWith("/src/main/ipc-handlers.ts")), []);
    for (const p of holders) {
      const text = files.get(p)!;
      assert.ok(!/\bconsole\b|process\.std(out|err)|\blog\(/.test(text), `${p} logs`);
      assert.ok(!/node:(net|http|https|dgram|tls)|\bfetch\(|WebSocket|electron.*\bnet\b/.test(text), `${p} reaches the network`);
    }
  });
});

test("the music-files modules exist where the guards look for them", () => {
  const dir = join(REPO, "player", "app", "src", "main", "music-files");
  assert.deepEqual(readdirSync(dir).sort(), ["handlers.ts", "hash-file.ts", "index-store.ts", "matcher.ts", "service.ts", "setup.ts", "walk.ts"]);
});

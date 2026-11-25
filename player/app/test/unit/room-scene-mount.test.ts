// The room window's scene is its own script (#677, S10, S11): the plain screen's script announces each frame it draws on the page's
// document, the scene's script listens, and the phone app, which bundles the plain screen's script, carries no three.js.
// The join's behaviour (reduced motion, kills, the 2 s deadline, the playlist plate) is tested in player/scene/render/test/.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions } from "esbuild";
import { BUILDS } from "../../build-config.mjs";
import type { RoomFrame } from "../../src/core/room/frame.ts";
import { announceFrame, onFrame, type FrameHost } from "../../src/renderer/room-frame-event.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const frame = { doc: null, view: null, link: null, band: null, pattern: null, playlistNotLoaded: true } as RoomFrame;

test("a frame announced on a page reaches the scene's listener, once, until it stops", () => {
  const page: FrameHost = {};
  const got: RoomFrame[] = [];
  const stop = onFrame(page, (f) => got.push(f));
  announceFrame(page, frame);
  assert.deepEqual(got, [frame]);
  stop();
  announceFrame(page, frame);
  assert.equal(got.length, 1);
});

test("a listener that joins after a frame was announced is given that frame at once, then the new ones", () => {
  const page: FrameHost = {};
  announceFrame(page, frame);
  const got: RoomFrame[] = [];
  onFrame(page, (f) => got.push(f));
  assert.deepEqual(got, [frame]);
  const next = { ...frame, playlistNotLoaded: false } as RoomFrame;
  announceFrame(page, next);
  assert.deepEqual(got, [frame, next]);
});

test("with no listener, announcing does nothing; frames on another page are not heard", () => {
  announceFrame({}, frame);
  const got: RoomFrame[] = [];
  onFrame({}, (f) => got.push(f));
  announceFrame({}, frame);
  assert.deepEqual(got, []);
});

test("a listener that throws does not stop the others or the caller; the error is reported", () => {
  const page: FrameHost = {};
  const got: RoomFrame[] = [];
  onFrame(page, () => { throw new Error("scene bug"); });
  onFrame(page, (f) => got.push(f));
  const errors: unknown[] = [];
  announceFrame(page, frame, (e) => errors.push(e));
  assert.deepEqual(got, [frame]);
  assert.equal((errors[0] as Error).message, "scene bug");
});

async function inputsOf(entry: string): Promise<string[]> {
  const b = BUILDS.find((o: BuildOptions) => (o.entryPoints as string[]).includes(entry))!;
  const r = await build({ ...b, absWorkingDir: APP, write: false, metafile: true, logLevel: "silent" });
  return Object.keys(r.metafile!.inputs);
}

test("the plain screen's script carries no three.js and none of the scene (the phone app bundles it); the scene's own script carries both", async () => {
  const plain = await inputsOf("src/renderer/room.ts");
  assert.ok(plain.length > 20);
  assert.deepEqual(plain.filter((i) => /node_modules\/three\/|scene\/render/.test(i)), []);
  const scene = await inputsOf("src/renderer/room-scene.ts");
  assert.ok(scene.some((i) => /node_modules\/three\//.test(i)));
  assert.ok(scene.some((i) => i.endsWith("scene/render/join/mount.ts")));
});

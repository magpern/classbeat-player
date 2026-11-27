// The planted-pattern test of ADR 0017 section 5 for local playback (#921): tone files with a known
// byte pattern, in a folder and under a file name that are known words, are found, checked before
// playing and played through `cbp-local:` in a fake class. No cue, report answer, play URL, response
// header, state, music-link reading, log line or stored file other than the index holds the
// pattern, a path, the folder name or the file name. The audio itself reaches only the answer to a
// live play. Tone fixture only; the network guard is on (the --import of every unit test).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import type { LocalCue } from "../../src/core/music-files/local-cue.ts";
import { localPlayIdOf } from "../../src/core/music-files/local-scheme-policy.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { createLocalPlayer } from "../../src/main/local/local-player.ts";
import { createLocalPlays } from "../../src/main/local/local-plays.ts";
import { toneWav } from "../../src/main/mix/test-mix.ts";
import { INDEX_DIR } from "../../src/main/music-files/index-store.ts";
import { answerLocalRequest } from "../../src/main/music-files/local-response.ts";
import { ACCT, CLASS_ID, musicRig, sha } from "./music-files-fakes.ts";
import { NetGuardError } from "./netguard.ts";
import net from "node:net";

const PATTERN = "PLANTED-7f3a9c-BYTES";
const FOLDER = "SENTINEL-FOLDER-41b2";
const FILE = "SENTINEL-FILE-93d0";
const TONE_MS = 2_000;
const tone = (k: number): Buffer => Buffer.concat([Buffer.from(toneWav(TONE_MS)), Buffer.from(`${PATTERN}-${k}`)]);

const classOf = (files: readonly Buffer[]) => ({
  format_version: "1.4",
  class: { length_ms: files.length * TONE_MS },
  music: { source: "local", design_crossfade_ms: 500 },
  songs: files.map((b, k) => ({ title: `Song ${k}`, start_ms: k * TONE_MS, end_ms: (k + 1) * TONE_MS, length_ms: TONE_MS, ids: { local_file: { sha256: sha(b), size_bytes: b.length, file_name: `${FILE}-${k}.wav` } } })),
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

test("the network guard is on for this file", () => {
  assert.throws(() => net.connect(80, "192.0.2.1"), NetGuardError);
});

test("checkOpen checks the open document with no dialog; indexed answers only the account's own file", async () => {
  const r = musicRig();
  try {
    const files = [tone(0), tone(1)];
    const doc = classOf(files);
    r.folder = join(r.music, FOLDER);
    files.forEach((b, k) => r.put(join(FOLDER, `${FILE}-${k}.wav`), b));
    r.doc = doc;
    assert.equal((await r.service.find(CLASS_ID))?.status, "done");
    const dialogs = r.dialogs;
    // A class opened from a file is in no list: the check reads the document it is given.
    r.doc = null;
    assert.deepEqual(await r.service.checkOpen(doc), { status: "done", songs: ["found", "found"], limit_reached: false });
    assert.equal(r.dialogs, dialogs);
    assert.deepEqual(await r.service.checkOpen({ ...doc, music: { source: "spotify" } }), { status: "failed" });
    assert.equal(r.service.indexed(ACCT, sha(files[0]!))?.size, files[0]!.length);
    assert.equal(r.service.indexed("d".repeat(64), sha(files[0]!)), null);
    assert.equal(r.service.indexed(ACCT, "e".repeat(64)), null);
    r.account = null;
    assert.deepEqual(await r.service.checkOpen(doc), { status: "failed" });
  } finally {
    r.done();
  }
});

test("a planted pattern, folder and file name reach nothing but the index and the live play's answer", async () => {
  const r = musicRig();
  const logged: string[] = [];
  const kept = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(kept) as Array<keyof typeof kept>) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    const files = [tone(0), tone(1), tone(2)];
    const doc = classOf(files);
    r.folder = join(r.music, FOLDER);
    files.forEach((b, k) => r.put(join(FOLDER, `${FILE}-${k}.wav`), b));
    r.doc = doc;
    const found = await r.service.find(CLASS_ID);

    let now = 0;
    const plays = createLocalPlays();
    const cues: LocalCue[] = [];
    const served: Array<{ status: number; headers: string; body: Buffer }> = [];
    const faults: string[] = [];
    const player = createLocalPlayer({ plays, check: (d) => r.service.checkOpen(d), account: () => r.account, roomId: () => 3, cue: (c) => cues.push(c), align: () => undefined, now: () => now });
    const snap = (status: string, classMs: number) => player.snapshot({ loadId: 1, doc, view: { status, classMs } } as unknown as Snapshot);
    // The room: fetch each cued play URL as its <audio> would, and report the tone's decoded length.
    const room = async () => {
      const c = cues[cues.length - 1]!;
      for (const [slot, s] of c.slots.entries()) {
        if (s.url === null) continue;
        const res = await answerLocalRequest(new Request(s.url, { headers: { range: "bytes=0-" } }), { live: (id) => plays.liveFrom(id, 3), indexed: (a, h) => r.service.indexed(a, h), onFault: (id) => faults.push(id) });
        served.push({ status: res.status, headers: JSON.stringify([...res.headers]), body: Buffer.from(await res.arrayBuffer()) });
        const report = { seq: c.seq, slot: slot as 0 | 1, positionMs: Math.max(0, s.positionMs), playing: c.playing, failed: false, durationMs: TONE_MS };
        player.report(report);
        player.report(report);
      }
    };
    snap("ready", 0);
    for (let i = 0; i < 20; i += 1) {
      await new Promise((ok) => setImmediate(ok));
      snap("ready", 0);
      if (cues.length > 0) await room();
    }
    snap("running", 0);
    assert.deepEqual(player.state(), { kind: "playing" });
    for (let t = 0; t <= 3 * TONE_MS; t += 250) {
      now = t;
      snap(t >= 3 * TONE_MS ? "ended" : "running", t);
      await room();
    }

    // Playback worked: each play's answer was its own file.
    assert.deepEqual(faults, []);
    for (const s of served) assert.equal(s.status, 206);
    assert.ok(files.every((f) => served.some((s) => s.body.equals(f))));
    for (const c of cues) for (const s of c.slots) assert.ok(s.url === null || localPlayIdOf(s.url) !== null, s.url ?? "");

    const words = [PATTERN, FOLDER, FILE, r.music, r.root, ...files.map(sha), ACCT];
    const outside = [
      ["the find's and check's answers", JSON.stringify([found, await r.service.checkOpen(doc)])],
      ["the cues", JSON.stringify(cues)],
      ["the response headers", served.map((s) => s.headers).join("\n")],
      ["the state and the link", JSON.stringify([player.state(), player.link().latest()])],
      ["the log", logged.join("\n")],
    ] as const;
    for (const [what, text] of outside) for (const w of words) assert.ok(!text.includes(w), `${what} holds ${w}`);
    // Stored files: the index may hold the paths (it is the index); nothing else under the app's data holds any of it.
    const stored = filesUnder(r.data).filter((p) => !relative(r.data, p).startsWith(INDEX_DIR));
    for (const p of stored) {
      const text = readFileSync(p).toString("latin1");
      for (const w of [PATTERN, FOLDER, FILE]) assert.ok(!text.includes(w), `${relative(r.data, p)} holds ${w}`);
    }
    assert.ok(statSync(join(r.data, INDEX_DIR)).isDirectory(), "the index was written");
  } finally {
    Object.assign(console, kept);
    r.done();
  }
});

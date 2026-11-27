// The live plays of local files and the `cbp-local:` answer (ADR 0017 section 3), on real temporary
// files: 128-bit ids bound to one webContents and account, ended on stop, close and sign-out; only
// a GET of a live play is answered, with one byte range at most, `no-store`, and the stream ends
// with the play. No Electron, no network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { IndexedFile } from "../../src/core/music-files/index-model.ts";
import { createLocalPlays } from "../../src/main/local/local-plays.ts";
import { answerLocalRequest } from "../../src/main/music-files/local-response.ts";

const ROOT = mkdtempSync(join(tmpdir(), "cbp-local-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const ACCT = "a".repeat(64);
const SHA = "b".repeat(64);
const BODY = Buffer.from(Array.from({ length: 600_000 }, (_, i) => i % 251));

function rig(content: Buffer = BODY) {
  const path = join(ROOT, `f-${Math.random().toString(16).slice(2)}.wav`);
  writeFileSync(path, content);
  const st = statSync(path);
  let file: IndexedFile | null = { path, size: st.size, mtimeMs: st.mtimeMs };
  const plays = createLocalPlays();
  const play = plays.begin({ webContentsId: 7, account: ACCT, loadId: 1, songIndex: 0, sha256: SHA, size: content.length });
  const faults: string[] = [];
  const deps = {
    live: (id: string) => plays.live(id),
    indexed: (a: string, s: string) => (a === ACCT && s === SHA ? file : null),
    onFault: (id: string) => faults.push(id),
  };
  const get = (headers: Record<string, string> = {}, url = `cbp-local://play/${play.id}`, method = "GET") => answerLocalRequest(new Request(url, { method, headers }), deps);
  return { path, plays, play, faults, get, setFile: (f: IndexedFile | null) => (file = f) };
}

test("a play id is 128 random bits, bound to its webContents; plays end one by one, all, per window and per account", () => {
  const plays = createLocalPlays();
  const of = (webContentsId: number, account: string) => plays.begin({ webContentsId, account, loadId: 1, songIndex: 0, sha256: SHA, size: 1 });
  const a = of(1, ACCT);
  const b = of(1, ACCT);
  const c = of(2, ACCT);
  const d = of(1, "c".repeat(64));
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.equal(new Set([a.id, b.id, c.id, d.id]).size, 4);
  assert.equal(plays.liveFrom(a.id, 1), a);
  assert.equal(plays.liveFrom(a.id, 2), null);
  assert.equal(plays.live(a.id.toUpperCase()), null);
  plays.end(a.id);
  assert.equal(plays.live(a.id), null);
  plays.endFor(2);
  assert.equal(plays.live(c.id), null);
  assert.equal(plays.live(b.id), b);
  plays.endAccount(ACCT);
  assert.equal(plays.live(b.id), null);
  assert.equal(plays.live(d.id), d);
  plays.endAll();
  assert.equal(plays.live(d.id), null);
  let asked = 0;
  createLocalPlays((n) => {
    asked = n;
    return Buffer.alloc(n);
  }).begin({ webContentsId: 1, account: ACCT, loadId: 1, songIndex: 0, sha256: SHA, size: 1 });
  assert.equal(asked, 16);
});

test("a live play gets the whole file, or one byte range, never stored and naming nothing", async () => {
  const r = rig();
  const whole = await r.get();
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("cache-control"), "no-store");
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal(whole.headers.get("content-length"), String(BODY.length));
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), BODY);
  const part = await r.get({ range: "bytes=1000-299999" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 1000-299999/${BODY.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), BODY.subarray(1000, 300_000));
  const names = [...whole.headers, ...part.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
  for (const secret of [r.path, ACCT, SHA, r.play.id, "f-"]) assert.ok(!names.includes(secret), secret);
  assert.deepEqual(r.faults, []);
});

test("any other request is an empty 404 or 405; an unsatisfiable range is 416", async () => {
  const r = rig();
  assert.equal((await r.get({}, undefined, "POST")).status, 405);
  assert.equal((await r.get({}, `cbp-local://play/${"f".repeat(32)}`)).status, 404);
  assert.equal((await r.get({}, `cbp-local://play/${r.play.id}?x`)).status, 404);
  const bad = await r.get({ range: `bytes=${BODY.length}-` });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), `bytes */${BODY.length}`);
  r.plays.end(r.play.id);
  const ended = await r.get();
  assert.equal(ended.status, 404);
  assert.equal(await ended.text(), "");
  assert.deepEqual(r.faults, []);
});

test("a file that changed, is gone, is a link or is not in the index is a 404 and one fault, by the play's id", async () => {
  const changed = rig();
  utimesSync(changed.path, new Date(), new Date(Date.now() + 60_000));
  assert.equal((await changed.get()).status, 404);
  assert.deepEqual(changed.faults, [changed.play.id]);
  const gone = rig();
  rmSync(gone.path);
  assert.equal((await gone.get()).status, 404);
  assert.deepEqual(gone.faults, [gone.play.id]);
  const none = rig();
  none.setFile(null);
  assert.equal((await none.get()).status, 404);
  assert.deepEqual(none.faults, [none.play.id]);
  if (process.platform !== "win32") {
    const linked = rig();
    const link = join(ROOT, "link.wav");
    symlinkSync(linked.path, link);
    const st = statSync(linked.path);
    linked.setFile({ path: link, size: st.size, mtimeMs: st.mtimeMs });
    assert.equal((await linked.get()).status, 404);
    assert.deepEqual(linked.faults, [linked.play.id]);
  }
});

test("a play that ends while it streams gets no more bytes", async () => {
  const r = rig();
  const res = await r.get();
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  r.plays.end(r.play.id);
  await assert.rejects(async () => {
    for (;;) if ((await reader.read()).done) return;
  }, /play ended/);
});

test("a file that shrinks while it streams ends the stream and is reported once", async () => {
  const r = rig();
  const res = await r.get();
  const reader = res.body!.getReader();
  await reader.read();
  writeFileSync(r.path, BODY.subarray(0, 1000));
  await assert.rejects(async () => {
    for (;;) if ((await reader.read()).done) return;
  }, /file unavailable/);
  assert.deepEqual(r.faults, [r.play.id]);
});

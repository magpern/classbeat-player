// What native code answers rider mode's page (issue #633), read strictly; the link's retries; and
// the remembered numbers. Native code holds the rider token: no answer the page reads has room for
// one, and no rider-mode page source names one. Nothing here touches a network.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NativeLink, RETRY_AFTER_MS, RETRY_MS, STABLE_MS } from "../src/rider/link.ts";
import type { Clock, LinkIntents } from "../src/rider/link.ts";
import { parseEvent, parseJoinReply } from "../src/rider/native.ts";
import type { NativeEvent } from "../src/rider/native.ts";
import { NUMBERS_KEY, Numbers } from "../src/rider/numbers.ts";
import type { Store } from "../src/rider/numbers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = "cbp_rdr_" + "Ab3_-".repeat(8) + "xyz";
const welcome = JSON.stringify({ v: 1, type: "welcome", role: "rider", hostConnected: true });
const UNEXPECTED = { kind: "answer", status: 0, body: null };

test("a join answer is read strictly, and one that carries a token is not taken", () => {
  assert.deepEqual(parseJoinReply({ result: "joined" }), { kind: "joined" });
  assert.deepEqual(parseJoinReply({ result: "unreachable" }), { kind: "unreachable" });
  assert.deepEqual(parseJoinReply({ result: "answer", status: 404, body: { error: "cannot_join" } }), { kind: "answer", status: 404, body: { error: "cannot_join" } });
  assert.deepEqual(parseJoinReply({ result: "answer", status: 429, body: null }), { kind: "answer", status: 429, body: null });
  for (const bad of [
    null,
    "joined",
    { result: "joined", riderToken: TOKEN },
    { result: "answer", status: 200, body: { riderToken: TOKEN } },
    { result: "answer", status: 404, body: { error: "x", token: TOKEN } },
    { result: "answer", status: 404, body: { error: "x".repeat(65) } },
    { result: "answer", status: 99, body: null },
    { result: "answer", status: 404 },
    { result: "left" },
  ]) {
    assert.deepEqual(parseJoinReply(bad), UNEXPECTED, JSON.stringify(bad));
  }
});

test("an event is read strictly: only rider-bound messages, and nothing with a token", () => {
  assert.deepEqual(parseEvent({ kind: "opened" }), { kind: "opened" });
  assert.deepEqual(parseEvent({ kind: "back" }), { kind: "back" });
  assert.deepEqual(parseEvent({ kind: "closed", code: 4401 }), { kind: "closed", code: 4401 });
  assert.equal(parseEvent({ kind: "frame", text: welcome })?.kind, "frame");
  for (const bad of [
    null,
    { kind: "opened", token: TOKEN },
    { kind: "closed", code: 999 },
    { kind: "closed", code: "4401" },
    { kind: "frame", text: JSON.stringify({ v: 1, type: "welcome", role: "host" }) },
    { kind: "frame", text: JSON.stringify({ v: 1, type: "hello", role: "rider", token: TOKEN }) },
    { kind: "frame", text: welcome, token: TOKEN },
    { kind: "frame", text: "x".repeat(70_000) },
    { kind: "token", text: TOKEN },
  ]) {
    assert.equal(parseEvent(bad), null, JSON.stringify(bad).slice(0, 80));
  }
});

test("no rider-mode page source names a token, a storage of its own or a native module", () => {
  const dir = join(HERE, "..", "src", "rider");
  const files = readdirSync(dir).filter((n) => n.endsWith(".ts"));
  assert.ok(files.length >= 6, files.join());
  for (const name of [...files.map((n) => join(dir, n)), join(HERE, "..", "src", "rider.ts")]) {
    // The code only: comments say where the token is (native code), which is not a use of one.
    // The design tokens' stylesheet is not a token either.
    const text = readFileSync(name, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace('"../../../web/src/design/tokens.css"', "");
    assert.doesNotMatch(text, /token|sessionStorage|indexedDB|document\.cookie/i, name);
    assert.doesNotMatch(text, /@capacitor\/core|registerPlugin|Capacitor\./, name);
    // The rider page's own token handling stays on the web (store.ts, net.ts, socket.ts).
    assert.doesNotMatch(text, /rider\/(store|net|socket)\.ts/, name);
  }
});

/** A fake clock and a fake native side: each `receive` waits for a pushed event. */
function harness() {
  let t = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const clock: Clock = {
    now: () => t,
    later(fn, ms) {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  const waiting: ((x: unknown) => void)[] = [];
  const opens: number[] = [];
  const intents: LinkIntents = {
    open: () => {
      opens.push(t);
      return Promise.resolve({ result: "opening" });
    },
    receive: () => new Promise((resolve) => waiting.push(resolve)),
  };
  const heard: NativeEvent[] = [];
  const link = new NativeLink(intents, (e) => heard.push(e), clock);
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    link,
    opens,
    heard,
    async push(x: unknown) {
      await settle();
      waiting.shift()?.(x);
      await settle();
    },
    advance(ms: number) {
      t += ms;
      for (const timer of timers.filter((x) => x.live && x.at <= t)) {
        timer.live = false;
        timer.fn();
      }
    },
  };
}

test("a lost link is opened again after 1 s, 2 s, then every 5 s, and from 1 s after a stable one", async () => {
  assert.deepEqual([RETRY_MS, RETRY_AFTER_MS, STABLE_MS], [[1000, 2000], 5000, 10_000]);
  const h = harness();
  h.link.start();
  const waits: number[] = [];
  for (let i = 0; i < 4; i++) {
    await h.push({ kind: "closed", code: 1006 });
    const before = h.opens.length;
    let waited = 0;
    while (h.opens.length === before) {
      h.advance(500);
      waited += 500;
    }
    waits.push(waited);
  }
  assert.deepEqual(waits, [1000, 2000, 5000, 5000]);
  await h.push({ kind: "frame", text: welcome });
  h.advance(STABLE_MS);
  await h.push({ kind: "closed", code: 1006 });
  h.advance(999);
  const n = h.opens.length;
  h.advance(1);
  assert.equal(h.opens.length, n + 1);
});

test("a final close, a stop or a refused receive opens nothing again", async () => {
  for (const code of [4401, 4403, 4409]) {
    const h = harness();
    h.link.start();
    await h.push({ kind: "closed", code });
    h.advance(60_000);
    assert.equal(h.opens.length, 1, String(code));
  }
  const h = harness();
  h.link.start();
  await h.push({ kind: "closed", code: 1006 });
  h.link.stop();
  h.advance(60_000);
  await h.push({ kind: "opened" });
  assert.equal(h.opens.length, 1);
  assert.equal(h.heard.length, 1);
});

/** A map that stands in for the web view's localStorage. */
function mapStore(): Store & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

test("the numbers are kept only when asked, under one key, and forget deletes them", () => {
  const s = mapStore();
  const n = new Numbers(() => s);
  assert.equal(n.works(), true);
  assert.equal(n.load(), null);
  assert.equal(n.remember({ ftp: 250, hrmax: 185 }), true);
  assert.deepEqual([...s.map.keys()], [NUMBERS_KEY]);
  assert.deepEqual(n.load(), { ftp: 250, hrmax: 185 });
  assert.doesNotMatch(s.map.get(NUMBERS_KEY) ?? "", /nickname|code|token/i);
  n.forget();
  assert.equal(s.map.size, 0);
  assert.equal(n.remember({ ftp: null, hrmax: null }), false);
  assert.equal(s.map.size, 0);
  const broken = new Numbers(() => {
    throw new Error("no storage");
  });
  assert.deepEqual([broken.works(), broken.load(), broken.remember({ ftp: 250, hrmax: null })], [false, null, false]);
  broken.forget();
});

// The pairing service (main/pairing/service.ts) with a fake backend, a fake keychain and a manual
// clock: the whole flow, where the device code and the token go (only to their own server and the
// keychain, never to the view or a log), unpair offline, and the check at startup.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import { recordText } from "../../src/core/pairing/record.ts";
import type { BackendRequest } from "../../src/main/pairing/http.ts";
import { memoryStore } from "../../src/main/pairing/keychain.ts";
import type { SecretStore } from "../../src/main/pairing/keychain.ts";
import { createPairingService } from "../../src/main/pairing/service.ts";
import { newToken, ORIGIN, PAGE, USER_CODE } from "./pairing-tokens.ts";

const logged: unknown[][] = [];
const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
beforeEach(() => {
  logged.length = 0;
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => void logged.push(a);
});
afterEach(() => Object.assign(console, saved));

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function rig(over: { store?: SecretStore; answer?: (r: BackendRequest) => HttpAnswer } = {}) {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const requests: (BackendRequest & { at: number })[] = [];
  const opened: string[] = [];
  const store = over.store ?? memoryStore();
  const deviceCode = newToken("dc");
  const token = newToken("dev");
  let polls = 0;
  const answer =
    over.answer ??
    ((r: BackendRequest): HttpAnswer => {
      if (r.path === "/api/pairing/start") return { kind: "http", status: 200, body: { device_code: deviceCode, user_code: USER_CODE, verification_uri: PAGE, expires_in: 600, interval: 5 }, retryAfterS: null };
      if (r.path === "/api/pairing/token") {
        polls += 1;
        return polls < 2 ? { kind: "http", status: 400, body: { error: "authorization_pending" }, retryAfterS: null } : { kind: "http", status: 200, body: { device_token: token, email: "ann@example.test" }, retryAfterS: null };
      }
      if (r.method === "GET") return { kind: "http", status: 200, body: { device: { name: "Studio" } }, retryAfterS: null };
      return { kind: "http", status: 204, body: undefined, retryAfterS: null };
    });
  const service = createPairingService({
    now: () => t,
    call: async (r) => (requests.push({ ...r, at: t }), answer(r)),
    store,
    openPage: (u) => void opened.push(u),
    origin: () => ({ ok: true, origin: ORIGIN }),
    allowLoopbackHttp: false,
    platform: "linux",
    version: "0.0.0",
    setTimer: (fn, ms) => (timers.push({ at: t + ms, fn, id: nextId }), nextId++),
    clearTimer: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  /** Moves the clock to `to`, firing each timer due on the way, and lets answers arrive. */
  const advance = async (to: number): Promise<void> => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (due === undefined || due.at > to) break;
      timers.shift();
      t = due.at;
      due.fn();
      await flush();
    }
    t = to;
  };
  return { service, requests, opened, store, deviceCode, token, timers, advance };
}

test("the whole flow: start, the page opened, polls no faster than 5 s, the token kept in the keychain", async () => {
  const r = rig();
  assert.deepEqual(r.service.start(), { state: "starting" });
  await flush();
  assert.deepEqual(r.opened, [PAGE]);
  assert.equal(r.service.view().state, "waiting");
  await r.advance(20_000);
  const polls = r.requests.filter((q) => q.path === "/api/pairing/token");
  assert.equal(polls.length, 2);
  assert.ok(polls[0].at >= 5000 && polls[1].at - polls[0].at >= 5000, JSON.stringify(polls.map((p) => p.at)));
  assert.deepEqual(r.service.view(), { state: "paired", email: "ann@example.test", deviceName: null, pairAgain: false });
  assert.equal(r.store.load(), recordText({ origin: ORIGIN, token: r.token, email: "ann@example.test" }));
  assert.deepEqual(r.timers, [], "no poll is left once paired");
});

test("the device code and the token go only to their own server, never to the view or a log", async () => {
  const r = rig();
  r.service.start();
  await flush();
  const views: unknown[] = [];
  for (let at = 1000; at <= 20_000; at += 1000) {
    await r.advance(at);
    views.push(r.service.view());
  }
  r.service.unpair();
  await flush();
  views.push(r.service.view());
  for (const q of r.requests) assert.equal(q.origin, ORIGIN);
  assert.deepEqual(
    r.requests.filter((q) => JSON.stringify(q).includes(r.token)).map((q) => `${q.method} ${q.path}`),
    ["DELETE /api/player/device"],
  );
  assert.ok(r.requests.filter((q) => JSON.stringify(q).includes(r.deviceCode)).every((q) => q.path === "/api/pairing/token"));
  const shown = JSON.stringify(views);
  assert.ok(!shown.includes(r.token) && !shown.includes(r.deviceCode) && !shown.includes("cbp_"), shown);
  assert.deepEqual(logged, []);
});

test("unpair offline: the token is deleted here all the same", async () => {
  const store = memoryStore();
  store.save(recordText({ origin: ORIGIN, token: newToken("dev"), email: "a@example.test" }));
  const r = rig({ store, answer: () => ({ kind: "unreachable" }) });
  r.service.load();
  await flush();
  assert.equal(r.service.view().state, "paired", "a network error at startup keeps the pairing");
  assert.equal(r.service.unpair().state, "unpaired");
  assert.equal(store.load(), null);
  assert.deepEqual(r.requests.map((q) => `${q.method} ${q.path}`), ["GET /api/player/device", "DELETE /api/player/device"]);
});

test("startup: a pairing revoked on the site is deleted; a broken record is deleted and nothing is sent", async () => {
  const store = memoryStore();
  store.save(recordText({ origin: ORIGIN, token: newToken("dev"), email: "a@example.test" }));
  const r = rig({ store, answer: () => ({ kind: "http", status: 401, body: { error: "token_revoked" }, retryAfterS: null }) });
  r.service.load();
  await flush();
  assert.deepEqual(r.service.view(), { state: "unpaired", message: "This computer was unpaired on the website." });
  assert.equal(store.load(), null);

  const broken = memoryStore();
  broken.save("{not json");
  const b = rig({ store: broken });
  b.service.load();
  await flush();
  assert.equal(broken.load(), null);
  assert.deepEqual(b.requests, []);
});

test("no keychain: pairing is refused with a message and nothing is sent", () => {
  const none: SecretStore = { available: () => false, load: () => null, save: () => assert.fail("saved"), clear: () => undefined };
  const r = rig({ store: none });
  const v = r.service.start();
  assert.equal(v.state, "unpaired");
  assert.match(v.state === "unpaired" ? (v.message ?? "") : "", /keychain/);
  assert.deepEqual(r.requests, []);
});

test("a token the keychain refuses is given back to the server", async () => {
  const failing: SecretStore = { ...memoryStore(), save: () => { throw new Error("locked"); } };
  const r = rig({ store: failing });
  r.service.start();
  await flush();
  await r.advance(20_000);
  assert.deepEqual(r.service.view(), { state: "unpaired", message: "The pairing could not be kept in the system keychain. Try again." });
  const last = r.requests.at(-1);
  assert.equal(`${last?.method} ${last?.path}`, "DELETE /api/player/device");
  assert.equal(last?.token, r.token);
});

test("stop ends the wait: no poll after the app quits", async () => {
  const r = rig();
  r.service.start();
  await flush();
  r.service.stop();
  await r.advance(60_000);
  assert.equal(r.requests.filter((q) => q.path === "/api/pairing/token").length, 0);
});

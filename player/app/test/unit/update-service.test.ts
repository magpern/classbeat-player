// The update checker (main/update/service.ts) on a fake feed, a fake clock and a fake settings
// file: the 6-hour timer, one check at a time, the last result kept while a new check runs, every
// failure (redirect, timeout, oversize, non-200, non-JSON, wrong shape) ending in "could not check"
// and dropping an earlier notice, and the class gate. No request leaves the process.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../../src/core/update/settings.ts";
import type { UpdateSettings } from "../../src/core/update/settings.ts";
import { RELEASE_PAGE_PREFIX } from "../../src/core/update/status.ts";
import { createFeedFetch, MAX_FEED_BYTES } from "../../src/main/update/feed-fetch.ts";
import { CHECK_EVERY_MS, createUpdateService } from "../../src/main/update/service.ts";
import { REPO } from "./fixtures.ts";

const fixture = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "updates", name), "utf8");
const release = (version: string): string => JSON.stringify([{ tag_name: `player-v${version}`, draft: false, prerelease: false, published_at: "2026-11-01T10:00:00Z" }]);
const ok = (body: string) => (): Response => new Response(body, { status: 200 });

/** A reply that never comes: only the request's own timeout ends it. AbortSignal.timeout's timer does
 *  not hold the process open, so this one does until the abort. */
const hang = (init: RequestInit): Promise<Response> =>
  new Promise<Response>((_, reject) => {
    const keep = setInterval(() => undefined, 1000);
    init.signal!.addEventListener("abort", () => {
      clearInterval(keep);
      reject(init.signal!.reason);
    });
  });

type Answer = (init: RequestInit) => Promise<Response> | Response;

function rig(opts: { settings?: Partial<UpdateSettings>; answers?: Answer[]; timeoutMs?: number } = {}) {
  const answers = [...(opts.answers ?? [])];
  const requests: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push(String(url));
    const next = answers.shift();
    if (next === undefined) throw new Error("no answer queued");
    return next(init ?? {});
  }) as typeof fetch;
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const saved: UpdateSettings[] = [];
  const opened: string[] = [];
  const cls = { open: false };
  const service = createUpdateService({
    current: "0.1.0",
    fetchFeed: createFeedFetch("0.1.0", impl, opts.timeoutMs ?? 10_000),
    store: { load: () => ({ ...DEFAULT_SETTINGS, ...opts.settings }), save: (s) => void saved.push(s) },
    classOpen: () => cls.open,
    openPage: (a) => void opened.push(a),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => void ((h as { cleared: boolean }).cleared = true),
  });
  const armed = () => timers.filter((t) => !t.cleared);
  /** The fake clock: the armed timer's 6 hours pass. */
  const tick = (): void => {
    const live = armed();
    assert.equal(live.length, 1, "one timer armed");
    live[0]!.cleared = true;
    live[0]!.fn();
  };
  return { service, requests, answers, timers, armed, tick, saved, opened, cls };
}

/** A reply held until the test lets it go. */
function held(body: string): { answer: Answer; release: () => void } {
  let go!: () => void;
  const ready = new Promise<void>((r) => (go = r));
  return { answer: async () => (await ready, new Response(body, { status: 200 })), release: () => go() };
}

test("with automatic checks on, start checks once and then every 6 hours on the fake clock", async () => {
  const r = rig({ answers: [ok(release("0.2.0")), ok(release("0.3.0"))] });
  r.service.start();
  await r.service.idle();
  assert.deepEqual(r.service.view(), { kind: "newer", current: "0.1.0", latest: "0.2.0", notice: "0.2.0", auto: true, prereleases: false });
  assert.equal(r.armed().length, 1);
  assert.equal(r.armed()[0]!.ms, CHECK_EVERY_MS);
  assert.equal(CHECK_EVERY_MS, 6 * 60 * 60 * 1000);
  r.tick();
  await r.service.idle();
  assert.equal(r.requests.length, 2);
  assert.equal(r.service.view()?.notice, "0.3.0");
  assert.equal(r.armed().length, 1, "armed again for the next 6 hours");
});

test("with automatic checks off, nothing is asked and no timer runs until Check now; before any result it cannot say it is up to date", async () => {
  const r = rig({ settings: { auto: false }, answers: [ok(release("0.1.0"))] });
  r.service.start();
  assert.equal(r.requests.length, 0);
  assert.equal(r.armed().length, 0);
  assert.deepEqual(r.service.view(), { kind: "could not check", current: "0.1.0", latest: null, notice: null, auto: false, prereleases: false });
  r.service.checkNow();
  await r.service.idle();
  assert.equal(r.service.view()?.kind, "up to date");
});

test("a check already running is not started again, and while it runs the last result and its notice stay", async () => {
  const second = held(release("0.2.0"));
  const r = rig({ answers: [ok(release("0.2.0")), second.answer] });
  r.service.start();
  await r.service.idle();
  assert.equal(r.service.checkNow()?.kind, "checking");
  r.service.checkNow();
  r.tick();
  assert.equal(r.requests.length, 2, "one request while one runs");
  assert.deepEqual(r.service.view(), { kind: "checking", current: "0.1.0", latest: "0.2.0", notice: "0.2.0", auto: true, prereleases: false });
  second.release();
  await r.service.idle();
  assert.equal(r.service.view()?.kind, "newer");
});

const FAILURES: [string, Answer][] = [
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } })],
  ["timeout", hang],
  ["oversize", () => new Response(new Uint8Array(MAX_FEED_BYTES + 1).fill(0x20), { status: 200 })],
  ["non-200", () => new Response(release("0.3.0"), { status: 500 })],
  ["non-JSON", ok(fixture("not-json.html"))],
  ["wrong shape", ok(fixture("wrong-shape.json"))],
  ["not a list", ok(fixture("not-array.json"))],
];

for (const [name, answer] of FAILURES) {
  test(`${name}: "could not check", the earlier notice dropped, "Latest version" from the last good check`, async () => {
    const r = rig({ answers: [ok(release("0.2.0")), answer], timeoutMs: 20 });
    r.service.start();
    await r.service.idle();
    assert.equal(r.service.view()?.notice, "0.2.0");
    r.service.checkNow();
    await r.service.idle();
    assert.deepEqual(r.service.view(), { kind: "could not check", current: "0.1.0", latest: "0.2.0", notice: null, auto: true, prereleases: false });
    assert.equal(r.service.openReleasePage(), false, "no release page after a failed check");
    assert.deepEqual(r.opened, []);
    assert.equal(r.requests.length, 2);
  });
}

test("a feed override that is not an https address fails closed with no request", async () => {
  for (const feed of ["http://feed.invalid/", "", "file:///etc/passwd"]) {
    const r = rig({ settings: { feed } });
    r.service.start();
    await r.service.idle();
    assert.equal(r.requests.length, 0, feed);
    assert.equal(r.service.view()?.kind, "could not check");
  }
});

test("the class gate: during a class nothing is shown or done, a result that arrives is held and shown after", async () => {
  const late = held(release("0.2.0"));
  const r = rig({ answers: [late.answer] });
  r.service.start();
  r.cls.open = true;
  assert.equal(r.service.view(), null);
  assert.equal(r.service.checkNow(), null);
  assert.equal(r.service.setAutomaticChecks(false), null);
  assert.equal(r.service.setPrereleases(true), null);
  assert.deepEqual(r.saved, [], "no setting changes during a class");
  late.release();
  await r.service.idle();
  assert.equal(r.service.view(), null, "held, not shown");
  assert.equal(r.service.openReleasePage(), false);
  assert.equal(r.requests.length, 1);
  r.cls.open = false;
  assert.equal(r.service.view()?.notice, "0.2.0");
  assert.equal(r.service.openReleasePage(), true);
  assert.deepEqual(r.opened, [`${RELEASE_PAGE_PREFIX}0.2.0`]);
});

test("a timer that fires during a class still checks, and a failure then drops the notice once the class ends", async () => {
  const r = rig({ answers: [ok(release("0.2.0")), () => new Response("", { status: 503 })] });
  r.service.start();
  await r.service.idle();
  r.cls.open = true;
  r.tick();
  await r.service.idle();
  assert.equal(r.service.view(), null);
  r.cls.open = false;
  assert.equal(r.service.view()?.kind, "could not check");
  assert.equal(r.service.view()?.notice, null);
});

test("Open release page opens only the shown newer version's page, built here", async () => {
  const r = rig({ answers: [ok(release("0.1.0"))] });
  r.service.start();
  await r.service.idle();
  assert.equal(r.service.openReleasePage(), false, "up to date: nothing to open");
  assert.deepEqual(r.opened, []);
});

test("Pre-releases on is saved and checks again; the newer pre-release is then the notice", async () => {
  const feed = JSON.stringify([
    { tag_name: "player-v0.2.0", draft: false, prerelease: false, published_at: "2026-11-01T10:00:00Z" },
    { tag_name: "player-v0.3.0-rc.1", draft: false, prerelease: true, published_at: "2026-11-02T10:00:00Z" },
  ]);
  const r = rig({ answers: [ok(feed), ok(feed)] });
  r.service.start();
  await r.service.idle();
  assert.equal(r.service.view()?.notice, "0.2.0");
  assert.equal(r.service.setPrereleases(true)?.prereleases, true);
  await r.service.idle();
  assert.equal(r.requests.length, 2);
  assert.equal(r.service.view()?.notice, "0.3.0-rc.1");
  assert.deepEqual(r.saved, [{ auto: true, prereleases: true, feed: null }]);
  assert.equal(r.service.setPrereleases(true)?.prereleases, true);
  assert.equal(r.requests.length, 2, "no change, no check");
});

test("Check automatically off clears the timer and is saved; on arms it again without a check", async () => {
  const r = rig({ answers: [ok(release("0.1.0"))] });
  r.service.start();
  await r.service.idle();
  assert.equal(r.service.setAutomaticChecks(false)?.auto, false);
  assert.equal(r.armed().length, 0);
  assert.equal(r.service.setAutomaticChecks(true)?.auto, true);
  assert.equal(r.armed().length, 1);
  assert.equal(r.requests.length, 1);
  assert.deepEqual(r.saved, [{ auto: false, prereleases: false, feed: null }, { auto: true, prereleases: false, feed: null }]);
});

test("a settings file that cannot be written keeps the switch for this run", async () => {
  let asked = 0;
  const service = createUpdateService({
    current: "0.1.0",
    fetchFeed: async () => (asked++, null),
    store: { load: () => ({ ...DEFAULT_SETTINGS, auto: false }), save: () => assert.fail("disk full") },
    classOpen: () => false,
    openPage: () => undefined,
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  assert.equal(service.setPrereleases(true)?.prereleases, true);
  await service.idle();
  assert.equal(asked, 1, "the changed switch still checks again");
  assert.equal(service.view()?.prereleases, true);
});

test("stop clears the timer, and a reply that arrives after it shows nothing new", async () => {
  const late = held(release("0.2.0"));
  const r = rig({ answers: [late.answer] });
  r.service.start();
  r.service.stop();
  assert.equal(r.armed().length, 0);
  late.release();
  await r.service.idle();
  assert.equal(r.service.view()?.notice, null);
  r.service.checkNow();
  assert.equal(r.requests.length, 1, "no check after stop");
});

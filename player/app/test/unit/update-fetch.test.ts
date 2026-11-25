// The release feed's one request (main/update/feed-fetch.ts) on a fake fetch: https only, no
// redirect followed, a timeout, a size cap, only 200 taken, and nothing of the player's sent but its
// name and version. Every failure is null, which the checker shows as "could not check".
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFeedFetch, MAX_FEED_BYTES } from "../../src/main/update/feed-fetch.ts";

const FEED = "https://feed.invalid/releases";
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

type Call = { url: string; init: RequestInit };

function fake(answer: (init: RequestInit) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer(init ?? {});
  }) as typeof fetch;
  return { calls, impl };
}

test("a 200 reply's text is returned; the request follows no redirect, stores nothing and sends only accept and the player's name", async () => {
  const f = fake(() => new Response("[]", { status: 200 }));
  assert.equal(await createFeedFetch("0.1.0", f.impl)(FEED), "[]");
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0]!;
  assert.equal(url, FEED);
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "omit");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(init.headers, { accept: "application/vnd.github+json", "user-agent": "classbeat-player/0.1.0" });
});

test("a redirect, a non-200 reply and an error are null", async () => {
  for (const status of [301, 302, 307, 404, 500, 204]) {
    const f = fake(() => new Response(status === 204 ? null : "[]", { status, headers: { location: "https://elsewhere.invalid/" } }));
    assert.equal(await createFeedFetch("0.1.0", f.impl)(FEED), null, String(status));
    assert.equal(f.calls.length, 1, "no second request: the redirect is not followed");
  }
  const thrown = fake(() => Promise.reject(new TypeError("network")));
  assert.equal(await createFeedFetch("0.1.0", thrown.impl)(FEED), null);
});

test("a reply that takes longer than the timeout is null", async () => {
  const f = fake(hang);
  assert.equal(await createFeedFetch("0.1.0", f.impl, 20)(FEED), null);
});

test("a reply larger than 1 MiB is null and its read stops", async () => {
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024).fill(0x20);
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      c.enqueue(chunk);
    },
  });
  const f = fake(() => new Response(body, { status: 200 }));
  assert.equal(await createFeedFetch("0.1.0", f.impl)(FEED), null);
  assert.ok(pulled * chunk.byteLength <= MAX_FEED_BYTES + 2 * chunk.byteLength, `read ${pulled} chunks`);
  const exact = fake(() => new Response(new Uint8Array(MAX_FEED_BYTES).fill(0x20), { status: 200 }));
  assert.equal((await createFeedFetch("0.1.0", exact.impl)(FEED))?.length, MAX_FEED_BYTES);
});

test("an address that is not https, carries a user name or is not an address makes no request", async () => {
  const f = fake(() => new Response("[]", { status: 200 }));
  const get = createFeedFetch("0.1.0", f.impl);
  for (const bad of ["http://feed.invalid/", "file:///etc/passwd", "https://u:p@feed.invalid/", "", "feed.invalid", `https://feed.invalid/${"a".repeat(3000)}`]) {
    assert.equal(await get(bad), null, bad);
  }
  assert.equal(f.calls.length, 0);
});

// How the site asks its backend (src/site/net/api.ts; ADR 0002, section 5): the request options
// that keep the Origin real and the session cookie the server's. A stand-in fetch records them.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { call } from "../../src/site/net/api.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function record(res: Response): { url: string; init: RequestInit }[] {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(res);
  }) as typeof fetch;
  return seen;
}

describe("a request to the site's API", () => {
  it("is made in cors mode, so the Origin stays real under no-referrer (#257)", async () => {
    const seen = record(new Response('{"status":"accepted"}', { status: 200 }));
    await call("POST", "sign-in/link", { email: "ana@example.com" });
    await call("GET", "classes");
    assert.equal(seen.length, 2);
    for (const { init } of seen) {
      assert.equal(init.mode, "cors");
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.redirect, "manual");
      assert.equal(init.referrerPolicy, "no-referrer");
      assert.equal(init.cache, "no-store");
    }
    assert.deepEqual(seen.map((s) => s.url), ["/api/site/sign-in/link", "/api/site/classes"]);
  });

  it("is offline when fetch gives no answer", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    assert.deepEqual(await call("GET", "classes"), { kind: "offline" });
  });
});

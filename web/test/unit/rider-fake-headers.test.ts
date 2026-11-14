// The rider fake serves /j with the headers the backend sets (backend/src/player_backend/
// rider_page_policy.py), read from that file's text as companion-fake-headers.test.ts reads
// control_page_policy.py, so the fake cannot drift from the backend. The check fails under a
// one-character change to either side: every non-blank character of the backend's code, and every
// character of every header the fake serves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ORIGIN, riderCsp, riderHeaders } from "../lib/rider-fake.ts";
import { ORIGINS, PATHS, RIDER_SOURCE, SKELETON, checkFake, codeOf, parseRiderRule, skeletonOf } from "../lib/rider-policy.ts";
import type { RiderRule } from "../lib/rider-policy.ts";

const SOURCE = RIDER_SOURCE();
const FAKE: RiderRule = { csp: riderCsp, headers: riderHeaders };
const other = (c: string): string => (c === "x" ? "y" : "x");
const mutate = (text: string, i: number): string => text.slice(0, i) + other(text[i]) + text.slice(i + 1);

describe("the rider fake's /j headers", () => {
  it("are the backend's, for every origin and path", () => {
    checkFake(SOURCE, FAKE);
    assert.equal(skeletonOf(SOURCE), SKELETON);
  });

  it("are the values this page was built for (the reader is not reading nothing)", () => {
    const rule = parseRiderRule(SOURCE);
    const csp = `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src ${ORIGIN}/api/live/join wss://site.test/api/live/ws; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`;
    assert.equal(rule.csp(ORIGIN), csp);
    const fixed = { "Content-Security-Policy": csp, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" };
    assert.deepEqual(rule.headers("/j", ORIGIN), { ...fixed, "Cache-Control": "no-store" });
    for (const p of ["/j/rider.js", "/j/rider.css", "/j/fonts/ui.woff2"]) assert.deepEqual(riderHeaders(p), { ...fixed, "Cache-Control": "no-cache" }, p);
    for (const p of ["/j/", "/j/index.html", "/j/rider.js.map", "/j/a/b/c.js", "/j/Upper.js", "/jx/a.js"]) assert.deepEqual(riderHeaders(p), { ...fixed, "Cache-Control": "no-store" }, p);
    assert.ok(PATHS.some((p) => riderHeaders(p)["Cache-Control"] === "no-cache") && PATHS.some((p) => riderHeaders(p)["Cache-Control"] === "no-store"));
    for (const bad of ["unsafe-", "data:", "blob:", "http:", "*"]) assert.ok(!csp.includes(bad), bad);
  });

  it("fail under a one-character change anywhere in the backend's code", () => {
    // Every non-blank character outside the docstrings and comments, which say nothing to a browser.
    const code = codeOf(SOURCE);
    let tried = 0;
    const missed: string[] = [];
    for (let i = 0; i < SOURCE.length; i++) {
      if (/\s/.test(SOURCE[i])) continue;
      const changed = mutate(SOURCE, i);
      if (codeOf(changed) === code) continue; // inside a docstring or a comment
      tried++;
      try {
        checkFake(changed, FAKE);
        missed.push(`${i}: ${JSON.stringify(SOURCE.slice(Math.max(0, i - 20), i + 20))}`);
      } catch {
        // the change was seen
      }
    }
    assert.ok(tried > 1000, `only ${tried} characters tried`);
    assert.deepEqual(missed, []);
  });

  it("fail under a one-character change to anything the fake serves", () => {
    let tried = 0;
    for (const o of ORIGINS) {
      const csp = riderCsp(o);
      for (let i = 0; i < csp.length; i++) {
        tried++;
        const fake: RiderRule = { csp: (x) => (x === o ? mutate(csp, i) : riderCsp(x)), headers: riderHeaders };
        assert.throws(() => checkFake(SOURCE, fake), Error, `${o} policy at ${i}`);
      }
    }
    for (const p of PATHS) {
      const real = riderHeaders(p);
      for (const [k, v] of Object.entries(real)) {
        for (const [text, put] of [
          [k, (t: string) => ({ ...Object.fromEntries(Object.entries(real).filter(([q]) => q !== k)), [t]: v })],
          [v, (t: string) => ({ ...real, [k]: t })],
        ] as const) {
          for (let i = 0; i < text.length; i++) {
            tried++;
            const fake: RiderRule = { csp: riderCsp, headers: (x, o) => (x === p && o === ORIGIN ? put(mutate(text, i)) : riderHeaders(x, o)) };
            assert.throws(() => checkFake(SOURCE, fake), Error, `${p} ${k} at ${i}`);
          }
        }
      }
    }
    assert.ok(tried > 3000, `only ${tried} changes tried`);
  });

  it("names the cause when the backend's file cannot be read", () => {
    assert.throws(() => parseRiderRule(SOURCE.replace("_LIVE_WS: Final", "_SOCKET: Final")), /changed shape/);
    assert.throws(() => parseRiderRule(SOURCE.replace('"X-Frame-Options": "DENY",\n', '"X-Frame-Options": "DENY",\n        "X-Extra": "1",\n')), /changed shape/);
    assert.throws(() => checkFake(SOURCE.replace("no-referrer", "same-origin"), FAKE), /headers of \/j/);
  });
});

// The pairing code stays out of the page address, every request address, the history, storage
// and the console in every pairing state, the refusal and error states as well as the happy path
// (ADR 0002, section 6; docs/design/site.md, "Devices and pairing"). It may go only in the body of
// `POST pairing/find` and `POST pairing/decide`.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, settled, traps } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { PAIR_TYPED } from "../lib/site-device-states.ts";
import { STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

/** Every spelling of a typed code a page might leak: as typed, as sent, in lower case, spaced. */
function spellings(typed: string): string[] {
  const letters = typed.replaceAll(/[\s-]/g, "").toUpperCase();
  const spaced = `${letters.slice(0, 4)} ${letters.slice(4)}`;
  const forms = [typed, letters, spaced, `${letters.slice(0, 4)}-${letters.slice(4)}`];
  return [...new Set([...forms, ...forms.map((f) => f.toLowerCase())])];
}

const BODY_ROUTES = ["POST pairing/find", "POST pairing/decide"];

describe("the code is in no address, history entry, store or log, in any pairing state", () => {
  const states = STATES.filter((s) => s.name in PAIR_TYPED);
  it("covers every pairing state", () => {
    assert.deepEqual(states.map((s) => s.name).sort(), Object.keys(PAIR_TYPED).sort());
    assert.ok(states.length >= 10);
  });

  for (const state of states) {
    it(state.name, async () => {
      const forms = spellings(PAIR_TYPED[state.name]);
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      await settled(site);
      const seen = await traps(site.page);
      for (const f of forms) {
        assert.ok(!site.page.url().includes(f), `the code in the address: ${site.page.url()}`);
        for (const u of site.urls) assert.ok(!u.includes(f), `the code in a request: ${u}`);
        for (const t of seen) assert.ok(!t.detail.includes(f), `the code in ${t.kind}: ${t.detail}`);
        for (const c of site.console) assert.ok(!c.includes(f), `the code in the console: ${c}`);
        for (const a of site.api) if (!BODY_ROUTES.includes(a.route)) assert.ok(!(a.body ?? "").includes(f), `the code sent to ${a.route}`);
      }
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console"].includes(t.kind)), []);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

describe("the spellings looked for", () => {
  it("include the typed code, the letters sent and their other forms", () => {
    assert.deepEqual(spellings("bcdf-ghjl").slice(0, 4), ["bcdf-ghjl", "BCDFGHJL", "BCDF GHJL", "BCDF-GHJL"]);
    assert.ok(spellings("BCDF-GH").includes("BCDFGH"));
    assert.ok(spellings("BCDF-GHJK").includes("bcdfghjk"));
  });
});

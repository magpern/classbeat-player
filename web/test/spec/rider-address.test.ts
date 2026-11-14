// The rider page's address on the real page (ADR 0007, section 5; rule 14), on the fake site: for
// every fragment of the table (test/lib/rider-fragments.ts), with and without a query string, the
// address afterwards holds at most `/j#<join>`. The page replaces it before it touches storage or
// the network; a control code stays in neither `location.href` nor any history entry (read from
// the browser itself), and the page only ever replaces the current entry, never adds one. A fragment changed later (hashchange) is cleaned
// the same way, and in a class the address keeps the class's code.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { domMetas, domPolicies } from "../lib/dom-policy.ts";
import { SECRET43 } from "../lib/live-examples.ts";
import { CTRL, FRAGMENTS } from "../lib/rider-fragments.ts";
import { ORIGIN, launchOffline, openRider } from "../lib/rider-fake.ts";
import type { RiderFake, RiderOptions } from "../lib/rider-fake.ts";

const TOKEN = `cbp_rdr_${SECRET43}`;
const JOIN = { answers: [{ status: 200, body: { riderToken: TOKEN } }] };
let browser: Browser;
const open = (o: Partial<RiderOptions> = {}): Promise<RiderFake> => openRider(browser, { width: 390, height: 844, clock: true, ...o });

/** The address of every entry in the tab's history, as the browser holds them (not as the page reports). */
async function entries(f: RiderFake): Promise<string[]> {
  const cdp = await f.context.newCDPSession(f.page);
  try {
    const h = (await cdp.send("Page.getNavigationHistory")) as { entries: { url: string }[] };
    return h.entries.map((e) => e.url);
  } finally {
    await cdp.detach();
  }
}

/** Every history call is a replace; the first one comes before any storage, fetch or socket use. */
async function onlyReplaced(f: RiderFake, label: string): Promise<void> {
  const traps = await f.traps();
  const calls = traps.filter((t) => t.kind === "history");
  assert.ok(calls.every((t) => t.detail.startsWith("replaceState ")), `${label}: ${JSON.stringify(calls)}`);
  for (const t of calls) assert.ok(!t.detail.split(" from ")[0].includes(CTRL), `${label}: ${t.detail}`);
  const first = traps.findIndex((t) => t.kind === "history");
  const firstUse = traps.findIndex((t) => ["storage", "fetch"].includes(t.kind));
  if (first >= 0 && firstUse >= 0) assert.ok(first < firstUse, `${label}: the address was replaced after ${traps[firstUse].detail}`);
}

describe("rider page: the address keeps only the join code", () => {
  before(async () => {
    browser = await launchOffline();
  });
  after(async () => {
    await browser.close();
  });

  const cases = FRAGMENTS.filter(([hash]) => hash === "" || hash.startsWith("#"));
  for (const query of ["", "?from=qr", `?c=KXPD-RMTB.${CTRL}`]) {
    it(`table of fragments${query ? ` after ${query}` : ""}`, async () => {
      for (const [hash, join, target] of cases) {
        const label = query + hash;
        const f = await open({ hash: label });
        try {
          if (join === null) await f.page.waitForSelector("#rider-code");
          else await f.page.waitForSelector(`text=${join}`);
          assert.equal(await f.page.evaluate(() => location.href), ORIGIN + target, label);
          // The address it was opened with is replaced in place: the history holds only about:blank and it.
          assert.deepEqual(await entries(f), ["about:blank", ORIGIN + target], label);
          await onlyReplaced(f, label);
          assert.equal(f.api.length, 0, label);
          assert.deepEqual(f.external, [], label);
        } finally {
          await f.context.close();
        }
      }
    });
  }

  it("the page as the browser reads it has no policy meta of its own, Report-Only included", async () => {
    // The browser's own DOM is the authority (test/lib/dom-policy.ts); rider-purity.test.ts reads the file.
    const f = await open({ ...JOIN, hash: "" });
    try {
      assert.deepEqual(domPolicies(await domMetas(f.page)), []);
      assert.equal(await f.page.evaluate(`document.querySelector("meta[name=referrer]")?.getAttribute("content") ?? ""`), "no-referrer");
    } finally {
      await f.context.close();
    }
  });

  it("a class restored from the tab's token, with no code in the address, keeps none: a bare code typed later is dropped", async () => {
    // The intent (app.ts, onHash): in a class the address holds the class's code and nothing else, so
    // a class that has no code of its own (the page was reloaded with the token, and no fragment)
    // holds none. The form is not on screen to take a typed code, and the address stays `/j`.
    const f = await open({ stored: TOKEN, hash: "", clock: false });
    try {
      await f.live.ready();
      await f.page.evaluate(() => (location.hash = "#KXPD-RMTB"));
      await f.page.waitForFunction(() => location.href === "https://site.test/j");
      await f.page.evaluate(() => (location.hash = "#junk"));
      await f.page.waitForFunction(() => location.href === "https://site.test/j");
    } finally {
      await f.context.close();
    }
  });

  it("cleans a fragment changed later, and in a class keeps the class's code", async () => {
    // A real clock: waitForFunction polls on the page's own timers.
    const f = await open({ ...JOIN, hash: "", clock: false });
    try {
      // A control code pasted into the address of the form: the join code is taken, the rest goes.
      await f.page.evaluate((c) => (location.hash = `#KXPD-RMTB.${c}`), CTRL);
      await f.page.waitForFunction(() => location.hash === "#KXPD-RMTB");
      await f.page.waitForSelector("text=KXPD-RMTB");
      await f.page.evaluate(() => (location.hash = "#junk"));
      await f.page.waitForFunction(() => location.href === "https://site.test/j");
      await f.page.evaluate(() => (location.hash = "#kxpd rmtb"));
      await f.page.waitForFunction(() => location.hash === "#KXPD-RMTB");
      await f.page.fill("#rider-nickname", "Anna");
      await f.page.click("[data-action=join]");
      await f.live.ready();
      // In the class: any other fragment is put back to the class's code.
      for (const hash of [`#KXPD-RMTB.${CTRL}`, `#${CTRL}`, "#junk", ""]) {
        await f.page.evaluate((x) => (location.hash = x), hash);
        await f.page.waitForFunction(() => location.href === "https://site.test/j#KXPD-RMTB");
      }
      assert.deepEqual(JSON.parse(f.api[0].body ?? ""), { session: "KXPD-RMTB", nickname: "Anna" });
      const urls = (await f.traps()).filter((t) => t.kind === "history").map((t) => t.detail.split(" from ")[0]);
      assert.ok(urls.length > 0 && urls.every((u) => !u.includes(CTRL)), JSON.stringify(urls));
      // The entries the test itself pushed (by setting location.hash) were each replaced in place:
      // no entry of the history holds a control code or anything but the bare class code.
      const all = await entries(f);
      assert.equal(all.length, 9, JSON.stringify(all));
      for (const u of all.slice(1)) assert.match(u, /^https:\/\/site\.test\/j(#KXPD-RMTB)?$/, JSON.stringify(all));
    } finally {
      await f.context.close();
    }
  });
});

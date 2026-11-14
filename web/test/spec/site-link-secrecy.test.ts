// What Connect an app handles stays where it belongs, in every state of Linked apps and Connect an
// app (ADR 0002, section 7; docs/design/site.md, "Account"): the source's `state` and challenge go
// only in the approval's body, and the link code of the approval's answer only in the one address
// the page leaves for. Neither is ever in another request, the page's markup, storage or the
// console. The values are tied to the state list (site-link-states.ts): every state that is given
// an address with a query, or an approval's answer, must list them, and each is first seen where it
// belongs, so the check cannot pass with nothing to look for.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, ORIGIN, settled, traps } from "../lib/site-fake.ts";
import type { Reply } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { CODE_CHALLENGE, LINK_CODE, LINK_SECRETS, LINK_STATES, SOURCE_STATE } from "../lib/site-link-states.ts";
import { STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const answers = (r: Reply | readonly Reply[] | undefined): readonly Reply[] => (r === undefined ? [] : Array.isArray(r) ? r : [r as Reply]);
const labels = (name: string): string[] => LINK_SECRETS[name].map((s) => s.value);

describe("the secrets map and the link states", () => {
  it("name the same states, and every link state is checked by the site checks", () => {
    assert.deepEqual(Object.keys(LINK_SECRETS).sort(), LINK_STATES.map((s) => s.name).sort());
    for (const s of LINK_STATES) assert.ok(STATES.includes(s), `${s.name} is not in STATES`);
  });

  it("give the source's state and challenge to every state opened with a query", () => {
    const queried = LINK_STATES.filter((s) => s.path.includes("?"));
    assert.ok(queried.length >= 8);
    for (const s of queried) for (const v of [SOURCE_STATE, CODE_CHALLENGE]) assert.ok(labels(s.name).includes(v), `${s.name} has a query but does not list ${v}`);
  });

  it("give the link code to every state that is handed an approval's answer", () => {
    const approved = LINK_STATES.filter((s) => answers(s.script?.["POST source-links/approve"]).some((a) => a.status === 200 && !a.hold));
    assert.ok(approved.length >= 1);
    for (const s of approved) {
      assert.ok(labels(s.name).includes(LINK_CODE), `${s.name} is handed an approval but does not list the link code`);
      assert.ok(s.leaves?.includes(LINK_CODE), `${s.name} does not name the address it leaves for`);
    }
  });

  it("no other state names an address to leave for", () => {
    for (const s of STATES) if (!LINK_STATES.includes(s)) assert.equal(s.leaves, undefined, s.name);
  });
});

describe("nothing the link handles is anywhere it does not belong", () => {
  for (const state of LINK_STATES) {
    it(state.name, async () => {
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      await settled(site);
      const seen = await traps(site.page);
      const markup = await site.page.content();
      const load = ORIGIN + state.path;
      assert.deepEqual(site.left, state.leaves === undefined ? [] : [state.leaves], "the addresses left for");
      for (const s of LINK_SECRETS[state.name]) {
        // First where it belongs: the checks below then have something real to look for.
        if (s.seen.in === "address") assert.ok(state.path.includes(s.value) && site.urls[0] === load, `${s.label} did not come in the address`);
        else if (s.seen.in === "body") {
          const route = s.seen.route;
          assert.ok(site.api.some((a) => a.route === route && (a.body ?? "").includes(s.value)), `${s.label} was not sent to ${route}`);
        } else assert.ok(site.left.length > 0 && site.left.every((u) => u.includes(s.value)), `${s.label} was not in the address left for`);
        if (!s.inAddress) assert.ok(!site.page.url().includes(s.value), `${s.label} in the address: ${site.page.url()}`);
        for (const u of site.urls) {
          if ((s.inAddress && u === load) || (s.inLeft && site.left.includes(u))) continue;
          assert.ok(!u.includes(s.value), `${s.label} in a request address: ${u}`);
        }
        assert.ok(!markup.includes(s.value), `${s.label} in the page's markup`);
        for (const t of seen) assert.ok(!t.detail.includes(s.value), `${s.label} in ${t.kind}: ${t.detail}`);
        for (const c of site.console) assert.ok(!c.includes(s.value), `${s.label} in the console: ${c}`);
        for (const a of site.api) if (!s.routes.includes(a.route)) assert.ok(!(a.body ?? "").includes(s.value), `${s.label} sent to ${a.route}`);
      }
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console"].includes(t.kind)), []);
      assert.deepEqual(site.unscripted, [], "an API request the state does not expect");
      assert.deepEqual(site.external, [], "a request to another origin");
      for (const a of site.api) assert.equal(new URL(a.url).search, "", `a query on ${a.route}`);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

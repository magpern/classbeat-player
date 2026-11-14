// The secrets of the account pages (the registration's challenge and user handle, the new
// credential, the sign-in challenge and assertion of "Confirm it is you") stay out of the page
// address, every request address, the history, storage and the console in every account state
// (ADR 0002, sections 4 and 5; docs/design/site.md, "Account"). Each may go only in the body of
// its own route. The secrets are tied to the state list (site-account-states.ts), and each one is
// first seen where it belongs, so the check cannot pass with nothing to look for.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, settled, traps } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { ACCOUNT_SECRETS, ACCOUNT_STATES } from "../lib/site-account-states.ts";
import type { Reply } from "../lib/site-fake.ts";
import { STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const OPTION_ROUTES = ["POST passkeys/options", "POST sign-in/passkey/options"];
const answers = (r: Reply | readonly Reply[] | undefined): readonly Reply[] => (r === undefined ? [] : Array.isArray(r) ? r : [r as Reply]);

describe("the secrets map and the account states", () => {
  it("name the same states, and every account state is checked by the site checks", () => {
    assert.deepEqual(Object.keys(ACCOUNT_SECRETS).sort(), ACCOUNT_STATES.map((s) => s.name).sort());
    for (const s of ACCOUNT_STATES) assert.ok(STATES.includes(s), `${s.name} is not in STATES`);
  });

  it("give secrets to every state that is handed passkey options", () => {
    const handed = ACCOUNT_STATES.filter((s) => OPTION_ROUTES.some((r) => answers(s.script?.[r]).some((a) => a.status === 200)));
    assert.ok(handed.length >= 5);
    for (const s of handed) assert.ok(ACCOUNT_SECRETS[s.name].length > 0, `${s.name} is handed options but has no secrets`);
  });
});

describe("no account secret is in an address, history entry, store or log", () => {
  for (const state of ACCOUNT_STATES) {
    it(state.name, async () => {
      const secrets = ACCOUNT_SECRETS[state.name];
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      await settled(site);
      const seen = await traps(site.page);
      for (const s of secrets) {
        // First where it belongs: the check below then has something real to look for.
        if ("body" in s.seen) {
          const route = s.seen.body;
          assert.ok(site.api.some((a) => a.route === route && (a.body ?? "").includes(s.value)), `${s.label} was not sent to ${route}`);
        } else {
          const bytes = s.seen.prompt.join(",");
          assert.ok(seen.some((t) => t.kind === "passkey" && t.detail.includes(`=${bytes} `)), `${s.label} was not given to the browser's prompt`);
        }
        assert.ok(!site.page.url().includes(s.value), `${s.label} in the address: ${site.page.url()}`);
        for (const u of site.urls) assert.ok(!u.includes(s.value), `${s.label} in a request address: ${u}`);
        for (const t of seen) assert.ok(!t.detail.includes(s.value), `${s.label} in ${t.kind}: ${t.detail}`);
        for (const c of site.console) assert.ok(!c.includes(s.value), `${s.label} in the console: ${c}`);
        for (const a of site.api) if (!s.routes.includes(a.route)) assert.ok(!(a.body ?? "").includes(s.value), `${s.label} sent to ${a.route}`);
      }
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console"].includes(t.kind)), []);
      assert.deepEqual(site.unscripted, [], "an API request the state does not expect");
      for (const a of site.api) assert.equal(new URL(a.url).search, "", `a query on ${a.route}`);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

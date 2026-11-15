// The secrets of the account pages (the registration's challenge and user handle, the new
// credential) stay out of the page address, every request address, the history, storage and the
// console in every account state (ADR 0002, sections 4 and 5; docs/design/site.md, "Account").
// Each may go only in the body of its own route. The secrets are tied to the state list
// (site-account-states.ts), and each one is first seen where it belongs, so the check cannot pass
// with nothing to look for. "Confirm it is you" signs in again at classbeat only (ADR 0010,
// sections 5 and 7): no account state asks for or sends a passkey sign-in or an email link, so the
// sign-in challenge and assertion have no account route to go to, and the check below says so.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, settled, traps } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { navigationProblems } from "../lib/site-navigations.ts";
import { ACCOUNT_SECRETS, ACCOUNT_STATES, NEW_CREDENTIAL } from "../lib/site-account-states.ts";
import type { Reply } from "../lib/site-fake.ts";
import { STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const START = "POST sign-in/classbeat/start";
const OPTION_ROUTES =["POST passkeys/options", "POST sign-in/passkey/options"];
/** The player's own sign-in, closed for every account kind there is today (ADR 0010, section 7). */
const OWN_SIGN_IN = ["POST sign-in/passkey/options", "POST sign-in/passkey", "POST sign-in/link", "POST sign-in/complete"];
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

  // A state whose credential or assertion is taken (200 or 201) has every part of it to look for,
  // in that route's body only (#421 N1): "at least one secret" would let a part go unchecked.
  // Each part is found by its name and its value: two parts can have the same value (a credential's
  // id and rawId), so the value alone would let one stand in for the other.
  it("script no passkey sign-in and no email link: 'Confirm it is you' goes to classbeat only (ADR 0010, sections 5 and 7)", () => {
    for (const s of ACCOUNT_STATES) for (const r of Object.keys(s.script ?? {})) assert.ok(!OWN_SIGN_IN.includes(r), `${s.name} scripts ${r}`);
  });

  // So the start-body check below always has something to check (#508 N1).
  it("include a state that sends the classbeat start and one that goes to classbeat", () => {
    assert.ok(ACCOUNT_STATES.filter((s) => answers(s.script?.[START]).length > 0).length >= 2, "no account state answers the classbeat start");
    assert.ok(ACCOUNT_STATES.some((s) => s.toClassbeat !== undefined), "no account state goes to classbeat");
  });

  for (const [route, what, parts] of [["POST passkeys", "credential", NEW_CREDENTIAL]] as const) {
    it(`give every part of what goes to ${route} to every state whose ${route} is taken`, () => {
      const taken = ACCOUNT_STATES.filter((s) => answers(s.script?.[route]).some((a) => a.status === 200 || a.status === 201));
      assert.ok(taken.length >= 1, `no state takes ${route}`);
      for (const s of taken) {
        for (const [part, value] of Object.entries(parts)) {
          const secret = ACCOUNT_SECRETS[s.name].find((x) => x.label === `${what} ${part}` && x.value === value);
          assert.ok(secret, `${s.name} does not look for ${part}`);
          assert.deepEqual(secret.routes, [route], `${s.name}: ${part} may go to other routes`);
          assert.deepEqual(secret.seen, { body: route }, `${s.name}: ${part} is not looked for in ${route}`);
        }
      }
    });
  }
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
      // A classbeat start carries the purpose only: no return entry (ADR 0010, section 6).
      const starts = site.api.filter((a) => a.route === START);
      for (const a of starts) assert.deepEqual(JSON.parse(a.body ?? "null"), { purpose: "reauth" });
      if (answers(state.script?.[START]).length > 0) assert.equal(starts.length, 1, `${state.name} did not send the classbeat start`);
      assert.deepEqual(navigationProblems(state, site), [], "a navigation the state does not declare");
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

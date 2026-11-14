// What Your data handles stays where it belongs, in every state of the page (docs/design/site.md,
// "Your data"; ADR 0002, sections 10 and 11): the export file's content only in the file the
// browser saved, and the typed email address only in the field and the body of
// `POST account/delete`. Neither is ever in the page's address, a request's address, another
// request's body, the markup, the history, storage, a cookie or the console. The values are tied to
// the state list (site-data-states.ts): every state handed an export file, or that types an address,
// must list it, and each is first seen where it belongs, so the check cannot pass with nothing to
// look for.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, settled, traps } from "../lib/site-fake.ts";
import type { Reply } from "../lib/site-fake.ts";
import { reach } from "../lib/site-measure.ts";
import { DATA_SECRETS, DATA_STATES, EXPORT_FILE, EXPORT_MARK, SAVED, TYPED, TYPED_WRONG } from "../lib/site-data-states.ts";
import { STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const answers = (r: Reply | readonly Reply[] | undefined): readonly Reply[] => (r === undefined ? [] : Array.isArray(r) ? r : [r as Reply]);
const values = (name: string): string[] => DATA_SECRETS[name].map((s) => s.value);
const DELETE = "POST account/delete";

describe("the secrets map and the data states", () => {
  it("name the same states, and every data state is checked by the site checks", () => {
    assert.deepEqual(Object.keys(DATA_SECRETS).sort(), DATA_STATES.map((s) => s.name).sort());
    for (const s of DATA_STATES) assert.ok(STATES.includes(s), `${s.name} is not in STATES`);
  });

  it("give the file's content to every state that is handed an export file", () => {
    const handed = DATA_STATES.filter((s) => answers(s.script?.["POST account/export"]).some((a) => a.status === 200 && !a.hold));
    assert.ok(handed.length >= 1);
    for (const s of handed) assert.ok(values(s.name).includes(EXPORT_MARK), `${s.name} is handed a file but does not list its content`);
  });

  it("give the typed address to every state that sends a deletion", () => {
    const sending = DATA_STATES.filter((s) => s.script?.[DELETE] !== undefined);
    assert.ok(sending.length >= 4);
    for (const s of sending) assert.ok(values(s.name).some((v) => v === TYPED || v === TYPED_WRONG), `${s.name} sends a deletion but lists no typed address`);
  });
});

describe("nothing the data page handles is anywhere it does not belong", () => {
  for (const state of DATA_STATES) {
    it(state.name, async () => {
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      await settled(site);
      const seen = await traps(site.page);
      const markup = await site.page.content();
      for (const s of DATA_SECRETS[state.name]) {
        // First where it belongs: the checks below then have something real to look for.
        if (s.seen === "file") {
          const saved = SAVED.get(site.page);
          assert.ok(saved && saved.name === EXPORT_FILE && saved.text.includes(s.value), `${s.label} was not in the saved file`);
        } else if (s.seen === "delete-body") {
          const bodies = site.api.filter((a) => a.route === DELETE).map((a) => JSON.parse(a.body ?? "null") as unknown);
          assert.ok(bodies.length > 0 && bodies.every((b) => JSON.stringify(b) === JSON.stringify({ confirm: s.value })), `${s.label} was not sent alone to ${DELETE}`);
        } else assert.equal(await site.page.inputValue("input[name=confirm]"), s.value, `${s.label} is not in the field`);
        assert.ok(!site.page.url().includes(s.value), `${s.label} in the address: ${site.page.url()}`);
        for (const u of site.urls) assert.ok(!decodeURIComponent(u).includes(s.value), `${s.label} in a request address: ${u}`);
        assert.ok(!markup.includes(s.value), `${s.label} in the page's markup`);
        for (const t of seen) assert.ok(!t.detail.includes(s.value), `${s.label} in ${t.kind}: ${t.detail}`);
        for (const c of site.console) assert.ok(!c.includes(s.value), `${s.label} in the console: ${c}`);
        for (const a of site.api) if (a.route !== DELETE || s.seen !== "delete-body") assert.ok(!(a.body ?? "").includes(s.value), `${s.label} sent to ${a.route}`);
      }
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console"].includes(t.kind)), []);
      assert.deepEqual(site.unscripted, [], "an API request the state does not expect");
      assert.deepEqual(site.external, [], "a request to another origin");
      assert.deepEqual(site.left, [], "a navigation away");
      for (const a of site.api) assert.equal(new URL(a.url).search, "", `a query on ${a.route}`);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

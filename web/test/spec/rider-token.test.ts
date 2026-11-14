// The rider page's secrets and privacy on the real page (docs/design/rider.md, "What the page
// holds"; ADR 0007 sections 1 and 6), on the fake site and live process:
// - the rider token is only in sessionStorage and in `hello`: never in the address, the DOM, a log,
//   a request, a referrer or localStorage; every frame the page sends is `hello`;
// - the rider's FTP and maximum heart rate are in no request body and no message, ever;
// - nothing is written to localStorage while Remember is off; with it on, exactly the two numbers;
//   Forget removes them;
// - the class code stays in the fragment (a typed one is written there); a query string goes;
// - a reload connects with the stored token; a lapsed token is the form with "away"; Removed
//   forgets the token; the nickname is shown as text, never as markup.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { SECRET43, examples } from "../lib/live-examples.ts";
import { NUMBERS_KEY, TOKEN_KEY, launchOffline, openRider } from "../lib/rider-fake.ts";
import type { RiderFake, RiderOptions } from "../lib/rider-fake.ts";

const TOKEN = `cbp_rdr_${SECRET43}`;
const FTP = "287";
const HRMAX = "193";
const STATE = examples("rider-state", "valid").find((e) => e.name.endsWith("/running-three-coming.json"))?.value as Record<string, unknown>;
const JOIN = { answers: [{ status: 200, body: { riderToken: TOKEN } }] };

let browser: Browser;
const open = (o: Partial<RiderOptions> = {}): Promise<RiderFake> => openRider(browser, { width: 390, height: 844, clock: true, ...o });

async function joinAs(f: RiderFake, o: { nickname?: string; numbers?: boolean; remember?: boolean } = {}): Promise<void> {
  await f.page.fill("#rider-nickname", o.nickname ?? "Anna");
  if (o.numbers !== false) {
    await f.page.fill("#rider-ftp", FTP);
    await f.page.fill("#rider-hrmax", HRMAX);
  }
  if (o.remember) await f.page.click("[data-action=remember]");
  await f.page.click("[data-action=join]");
  await f.page.clock.runFor(50);
  await f.live.ready();
  f.live.send(STATE);
  await f.page.waitForSelector(".run");
}

const local = (f: RiderFake): Promise<Record<string, string>> => f.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, String(Storage.prototype.getItem.call(localStorage, k))])));
const session = (f: RiderFake): Promise<string[]> => f.page.evaluate(() => Object.keys(sessionStorage));

/** Everything the page let out or kept anywhere but sessionStorage and `hello`. */
async function leaks(f: RiderFake, secret: string): Promise<string[]> {
  const out: string[] = [];
  if (f.page.url().includes(secret)) out.push(`address ${f.page.url()}`);
  if ((await f.page.content()).includes(secret)) out.push("DOM");
  for (const s of f.api) if (s.url.includes(secret) || (s.body ?? "").includes(secret) || JSON.stringify(s.headers).includes(secret)) out.push(`request ${s.url}`);
  for (const u of [...f.live.urls, ...f.external]) if (u.includes(secret)) out.push(`url ${u}`);
  for (const t of await f.traps()) if (t.kind !== "storage" && t.detail.includes(secret)) out.push(`${t.kind} ${t.detail}`);
  if (JSON.stringify(await local(f)).includes(secret)) out.push("localStorage");
  return out;
}

describe("rider page: token, numbers and storage", () => {
  before(async () => {
    browser = await launchOffline();
  });
  after(async () => {
    await browser.close();
  });

  it("sends exactly session and nickname, then only hello: never the FTP or the maximum heart rate", async () => {
    const f = await open(JOIN);
    try {
      await joinAs(f);
      assert.equal(f.api.length, 1);
      const r = f.api[0];
      assert.equal(r.method, "POST");
      assert.equal(r.url, "https://site.test/api/live/join");
      assert.deepEqual(JSON.parse(r.body ?? ""), { session: "KXPD-RMTB", nickname: "Anna" });
      assert.equal(r.headers.cookie, undefined);
      assert.equal(r.headers.referer, undefined);
      assert.deepEqual(f.live.urls, ["wss://site.test/api/live/ws"]);
      assert.deepEqual(f.live.sent.map((t) => JSON.parse(t) as unknown), [{ v: 1, type: "hello", token: TOKEN }]);
      for (const secret of [FTP, HRMAX]) {
        for (const s of f.api) assert.ok(!(s.url + (s.body ?? "")).includes(secret), `${secret} in ${s.url}`);
        for (const t of f.live.sent) assert.ok(!t.includes(secret), `${secret} in a frame`);
        assert.ok(!f.page.url().includes(secret));
      }
      assert.deepEqual(f.external, []);
    } finally {
      await f.context.close();
    }
  });

  it("keeps the token in sessionStorage and hello only, and writes nothing to localStorage while Remember is off", async () => {
    const f = await open(JOIN);
    try {
      await joinAs(f);
      assert.deepEqual(await leaks(f, TOKEN), []);
      assert.deepEqual(await leaks(f, SECRET43), []);
      assert.deepEqual(await session(f), [TOKEN_KEY]);
      assert.deepEqual(await local(f), {});
      const traps = await f.traps();
      assert.deepEqual(traps.filter((t) => t.kind === "storage" && t.detail.startsWith("local ") && !t.detail.startsWith("local getItem")), [], "no localStorage write");
      assert.deepEqual(traps.filter((t) => ["console", "error", "csp", "cookie"].includes(t.kind)), []);
      assert.equal(f.page.url(), "https://site.test/j#KXPD-RMTB", "the code stays in the fragment");
    } finally {
      await f.context.close();
    }
  });

  it("with Remember on, keeps exactly the two numbers in localStorage; Forget removes them", async () => {
    const f = await open(JOIN);
    try {
      await joinAs(f, { remember: true });
      assert.deepEqual(await local(f), { [NUMBERS_KEY]: `{"ftp":${FTP},"hrmax":${HRMAX}}` });
      assert.ok(!(f.api[0].body ?? "").includes(FTP));
    } finally {
      await f.context.close();
    }
    const g = await open({ remembered: '{"ftp":250,"hrmax":185}' });
    try {
      assert.equal(await g.page.inputValue("#rider-ftp"), "250");
      assert.equal(await g.page.getAttribute("[data-action=remember]", "aria-checked"), "true");
      await g.page.click("[data-action=forget]");
      assert.deepEqual(await local(g), {});
      assert.equal(await g.page.inputValue("#rider-ftp"), "");
      assert.equal(await g.page.inputValue("#rider-hrmax"), "");
      assert.equal(await g.page.getAttribute("[data-action=remember]", "aria-checked"), "false");
      assert.equal(await g.page.locator("[data-action=forget]").count(), 0, "Forget only while something is remembered");
    } finally {
      await g.context.close();
    }
  });

  it("Remember turned off before Join removes what was remembered", async () => {
    const f = await open({ ...JOIN, remembered: '{"ftp":250,"hrmax":185}' });
    try {
      await f.page.click("[data-action=remember]");
      await joinAs(f, { numbers: false });
      assert.deepEqual(await local(f), {});
    } finally {
      await f.context.close();
    }
  });

  it("works where localStorage is blocked: the switch is disabled and nothing is written", async () => {
    const f = await open({ ...JOIN, noStorage: true });
    try {
      await f.page.waitForSelector("text=Not available on this phone");
      assert.equal(await f.page.getAttribute("[data-action=remember]", "aria-disabled"), "true");
      await joinAs(f);
      const traps = await f.traps();
      assert.deepEqual(traps.filter((t) => t.kind === "storage" && t.detail.startsWith("local ") && !t.detail.startsWith("local getItem")), []);
    } finally {
      await f.context.close();
    }
  });

  it("writes a typed code into the fragment and drops a query string", async () => {
    const f = await open({ ...JOIN, hash: "" });
    try {
      await f.page.fill("#rider-code", "kxpd rmtb");
      await joinAs(f);
      assert.equal(f.page.url(), "https://site.test/j#KXPD-RMTB");
      assert.deepEqual(JSON.parse(f.api[0].body ?? ""), { session: "KXPD-RMTB", nickname: "Anna" });
    } finally {
      await f.context.close();
    }
    const g = await open({ hash: "?from=qr#KXPD-RMTB" });
    try {
      assert.equal(g.page.url(), "https://site.test/j#KXPD-RMTB");
      await g.page.waitForSelector("text=KXPD-RMTB");
    } finally {
      await g.context.close();
    }
  });

  it("a reload connects with the stored token and sends no join request", async () => {
    const f = await open({ stored: TOKEN });
    try {
      await f.page.clock.runFor(50);
      await f.live.ready();
      f.live.send(STATE);
      await f.page.waitForSelector(".run");
      assert.deepEqual(f.api, []);
      assert.deepEqual(f.live.sent.map((t) => JSON.parse(t) as unknown), [{ v: 1, type: "hello", token: TOKEN }]);
      assert.equal(await f.page.locator(".who-t").innerText(), "Joined");
    } finally {
      await f.context.close();
    }
  });

  it("a lapsed token (4401) forgets the token and shows the form with the away plate, values kept", async () => {
    const f = await open(JOIN);
    try {
      await joinAs(f);
      await f.live.close(4401);
      await f.page.waitForSelector("text=You were away too long");
      assert.deepEqual(await session(f), []);
      assert.equal(await f.page.inputValue("#rider-nickname"), "Anna");
      assert.equal(await f.page.inputValue("#rider-ftp"), FTP);
      await f.page.clock.runFor(10_000);
      assert.equal(f.live.urls.length, 1, "no new try with a lapsed token");
    } finally {
      await f.context.close();
    }
  });

  it("Removed forgets the token and offers no rejoin key", async () => {
    const f = await open(JOIN);
    try {
      await joinAs(f);
      f.live.send({ v: 1, type: "ended", reason: "dropped" });
      await f.page.waitForSelector("text=The instructor removed you from this class");
      assert.deepEqual(await session(f), []);
      assert.equal(await f.page.locator("[data-action]").count(), 0);
    } finally {
      await f.context.close();
    }
  });

  it("reconnects with hello only, and My numbers changes the effort without sending anything", async () => {
    const f = await open(JOIN);
    try {
      await joinAs(f, { numbers: false });
      await f.live.close(1006);
      await f.page.waitForSelector("text=Reconnecting");
      await f.page.clock.runFor(1100);
      await f.live.ready();
      f.live.send({ ...STATE, seq: (STATE.seq as number) + 1 });
      await f.page.click("[data-action=my_numbers]");
      await f.page.fill("#rider-ftp", "300");
      await f.page.click("[data-action=done]");
      await f.page.waitForSelector("text=273–315");
      assert.equal(f.api.length, 1);
      assert.equal(f.live.urls.length, 2);
      for (const t of f.live.sent) assert.deepEqual(JSON.parse(t), { v: 1, type: "hello", token: TOKEN });
      assert.ok(f.live.sent.every((t) => !t.includes("300")));
    } finally {
      await f.context.close();
    }
  });

  it("shows the nickname as text, never as markup", async () => {
    const f = await open(JOIN);
    const nick = "<b id=x>Hi</b>&amp;";
    try {
      await joinAs(f, { nickname: nick });
      assert.equal(await f.page.locator(".who-t").textContent(), `Joined as ${nick}`);
      assert.equal(await f.page.locator("#x").count(), 0);
      assert.deepEqual(JSON.parse(f.api[0].body ?? ""), { session: "KXPD-RMTB", nickname: nick });
    } finally {
      await f.context.close();
    }
  });
});

// The companion page connected to the fake live process, on recorded messages and Playwright's
// clock: the countdown between messages, stale and lost, the keys with their pending and ack
// states, the hold, reconnecting, the wake lock, and only the contract's frames going out.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { ACTIONS } from "../../src/companion/core/state-check.ts";
import { NO_ANSWER, REFUSAL_WORDS } from "../../src/companion/core/words.ts";
import { DIST, WEB_DIR } from "../lib/browser.ts";
import { ORIGIN, controlCsp, launchOffline, openCompanion } from "../lib/companion-fake.ts";
import type { Fake, OpenOptions } from "../lib/companion-fake.ts";
import { hasPolicyMeta, referrerMetas } from "../lib/html-meta.ts";
import { SECRET43, examples } from "../lib/live-examples.ts";

const TOKEN = `cbp_ctl_${SECRET43}`;
const recorded = (name: string): Record<string, unknown> => examples("companion-state", "valid").find((e) => e.name.endsWith(`/${name}.json`))?.value as Record<string, unknown>;
const FOLLOWING = recorded("following-locked");
const MANUAL: Record<string, unknown> = { ...FOLLOWING, link: { mode: "manual", state: "manual", canUndo: false, announcement: null }, allowed: ["pause", "skip", "nudge"] };

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

async function connected(state: Record<string, unknown>, o: Partial<OpenOptions> = {}): Promise<Fake> {
  const f = await openCompanion(browser, { width: 390, height: 844, stored: TOKEN, clock: true, ...o });
  await f.page.clock.runFor(100);
  f.live.send(state);
  await f.page.waitForSelector(".run .count");
  return f;
}
const text = (f: Fake, sel: string): Promise<string> => f.page.locator(sel).first().innerText();
const commands = (f: Fake): Record<string, unknown>[] => f.live.sent.map((t) => JSON.parse(t) as Record<string, unknown>).filter((m) => m.type === "command");

describe("companion live: the countdown between messages", () => {
  it("runs from the state's moment, Not live after 3 s, no countdown after 10 s", async () => {
    const f = await connected(FOLLOWING);
    assert.equal(await text(f, ".count"), "0:46");
    await f.page.clock.runFor(2000);
    assert.equal(await text(f, ".count"), "0:44");
    assert.equal(await text(f, ".cl .lbl"), "Interval left");
    await f.page.clock.runFor(1500);
    assert.equal(await text(f, ".cl .lbl"), "Not live");
    assert.ok(await f.page.locator(".count.est").count());
    assert.equal(await text(f, ".keys .msg"), "Keys work again when the computer is back");
    await f.page.clock.runFor(7000);
    await f.page.waitForSelector("text=Last seen");
    assert.equal(await f.page.locator(".count").count(), 0);
    await f.context.close();
  });

  it("a state with a lower seq is ignored; a new run replaces everything", async () => {
    const f = await connected(FOLLOWING);
    f.live.send({ ...FOLLOWING, seq: 40, now: { ...(FOLLOWING.now as object), cue: "Old cue" } });
    await f.page.clock.runFor(300);
    assert.equal(await text(f, ".cue"), (FOLLOWING.now as { cue: string }).cue);
    f.live.send({ ...recorded("not-started"), run: "Q2xhc3NSdW4tMDAwMDAwMg" });
    await f.page.waitForSelector("[data-action=start]");
    await f.context.close();
  });

  it("the phone's connection drops: Reconnecting, then a new try with the same token after 1 s", async () => {
    const f = await connected(FOLLOWING);
    await f.live.close(1006);
    await f.page.waitForSelector("text=Reconnecting");
    assert.equal(await text(f, ".keys .msg"), "Keys work again when the phone is back");
    await f.page.clock.runFor(1100);
    await f.page.waitForFunction(() => true);
    assert.equal(f.live.urls.length, 2);
    const hellos = f.live.sent.filter((t) => JSON.parse(t).type === "hello");
    assert.deepEqual(hellos.map((t) => JSON.parse(t)), [{ v: 1, type: "hello", token: TOKEN }, { v: 1, type: "hello", token: TOKEN }]);
    await f.context.close();
  });
});

describe("companion live: keys, pending and ack", () => {
  it("Pause is one touch: the command from the state, Sending, then the note on applied", async () => {
    const f = await connected(MANUAL);
    await f.page.click("[data-action=pause]");
    const [c] = commands(f);
    assert.deepEqual(Object.keys(c).sort(), ["action", "basis", "id", "run", "type", "v"]);
    assert.deepEqual([c.action, c.run, c.basis], ["pause", MANUAL.run, MANUAL.seq]);
    assert.match(String(c.id), /^[A-Za-z0-9_-]{22}$/);
    assert.equal(await text(f, "[data-action=pause] .kl"), "Sending…");
    await f.page.click("[data-action=pause]");
    assert.equal(commands(f).length, 1, "a sending key sends nothing more");
    f.live.send({ v: 1, type: "ack", id: c.id, result: "applied", reason: null });
    await f.page.waitForSelector(".top .note >> text=Paused");
    await f.context.close();
  });

  it("the nudges carry exactly -5000 and +5000 ms", async () => {
    const f = await connected(MANUAL);
    await f.page.click("[data-action=nudge][data-delta='-5000']");
    await f.page.click("[data-action=nudge][data-delta='5000']");
    assert.deepEqual(commands(f).map((c) => [c.action, c.deltaMs]), [["nudge", -5000], ["nudge", 5000]]);
    await f.context.close();
  });

  it("greyed keys send nothing (the nudges while following)", async () => {
    const f = await connected(FOLLOWING);
    for (const k of await f.page.locator("[data-action=nudge]").all()) {
      assert.equal(await k.getAttribute("aria-disabled"), "true");
      await k.click({ force: true });
    }
    assert.equal(commands(f).length, 0);
    await f.context.close();
  });

  it("skip is held 0.8 s: a short tap says so and sends nothing", async () => {
    const f = await connected(MANUAL);
    const box = await f.page.locator("[data-action=skip]").boundingBox();
    assert.ok(box);
    await f.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await f.page.mouse.down();
    await f.page.clock.runFor(300);
    await f.page.mouse.up();
    assert.equal(await text(f, "[data-action=skip] .kh"), "Hold to skip");
    assert.equal(commands(f).length, 0);
    await f.page.mouse.down();
    await f.page.clock.runFor(500);
    assert.equal(await text(f, "[data-action=skip] .kl"), "Keep holding");
    assert.equal(commands(f).length, 0, "not before 0.8 s");
    await f.page.clock.runFor(350);
    await f.page.mouse.up();
    assert.deepEqual(commands(f).map((c) => c.action), ["skip"]);
    await f.context.close();
  });

  it("sliding off a held key cancels it", async () => {
    const f = await connected(MANUAL);
    const box = await f.page.locator("[data-action=skip]").boundingBox();
    assert.ok(box);
    await f.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await f.page.mouse.down();
    await f.page.clock.runFor(200);
    await f.page.mouse.move(box.x + box.width / 2, box.y - 40);
    await f.page.clock.runFor(1000);
    await f.page.mouse.up();
    assert.equal(commands(f).length, 0);
    await f.context.close();
  });

  // The keys are drawn again when another key's ack comes; a hold on the old button ends with it
  // and never fires (review B1 on #261).
  for (const [how, liftAt] of [["a short tap", 250], ["a hold past 0.8 s", 900]] as const) {
    it(`a redraw of the keys during a hold ends it: ${how} on skip sends nothing`, async () => {
      const f = await connected(MANUAL);
      await f.page.click("[data-action=nudge][data-delta='5000']");
      const [nudge] = commands(f);
      const box = await f.page.locator("[data-action=skip]").boundingBox();
      assert.ok(box);
      await f.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await f.page.mouse.down();
      await f.page.clock.runFor(100);
      f.live.send({ v: 1, type: "ack", id: nudge.id, result: "applied", reason: null });
      await f.page.waitForSelector("[data-action=nudge][data-delta='5000']:not([aria-busy])");
      await f.page.clock.runFor(liftAt - 100);
      await f.page.mouse.up();
      await f.page.clock.runFor(1500);
      assert.deepEqual(commands(f).map((c) => c.action), ["nudge"]);
      await f.context.close();
    });
  }

  it("refused: the reason's words in skip's place for 4 s", async () => {
    const f = await connected(MANUAL);
    await f.page.click("[data-action=pause]");
    const [c] = commands(f);
    f.live.send({ v: 1, type: "ack", id: c.id, result: "refused", reason: "would_stop_following" });
    await f.page.waitForSelector(`.notice >> text=${REFUSAL_WORDS.would_stop_following}`);
    await f.page.clock.runFor(4100);
    assert.equal(await f.page.locator(".notice").count(), 0);
    await f.context.close();
  });

  it("no ack in 3 s: No answer", async () => {
    const f = await connected(MANUAL);
    await f.page.click("[data-action=pause]");
    // States keep coming (the class goes on), none of them with the ack; each is on screen
    // before the clock moves on.
    for (let k = 1; k <= 2; k += 1) {
      await f.page.clock.runFor(1000);
      f.live.send({ ...MANUAL, seq: (MANUAL.seq as number) + k, now: { ...(MANUAL.now as object), cue: `Cue ${k}` } });
      await f.page.waitForSelector(`.cue >> text=Cue ${k}`);
    }
    await f.page.clock.runFor(1300);
    await f.page.waitForSelector(`.notice >> text=${NO_ANSWER}`);
    await f.context.close();
  });

  it("everything the page sent is a hello or a command of the six actions (rule 2)", async () => {
    const f = await connected(MANUAL);
    await f.page.click("[data-action=pause]");
    await f.page.click("[data-action=nudge][data-delta='5000']");
    for (const t of f.live.sent) {
      const m = JSON.parse(t) as Record<string, unknown>;
      assert.ok(m.type === "hello" || m.type === "command", t);
      if (m.type === "command") assert.ok(ACTIONS.includes(m.action as never), t);
    }
    for (const k of await f.page.locator("[data-action]").all()) assert.ok(ACTIONS.includes((await k.getAttribute("data-action")) as never));
    await f.context.close();
  });
});

describe("companion live: the end, the wake lock and the page's policy", () => {
  it("ended: the session-ended page with Get control again, back to the entry page", async () => {
    const f = await connected(FOLLOWING);
    f.live.send({ v: 1, type: "ended", reason: "host_ended" });
    await f.page.click("[data-action=get_control]");
    await f.page.waitForSelector("#class-code");
    await f.context.close();
  });

  it("asks for the screen wake lock while connected and gives it back after", async () => {
    const f = await connected(FOLLOWING);
    f.live.send({ v: 1, type: "ended", reason: "expired" });
    await f.page.waitForSelector("text=The class session has ended");
    const wake = (await f.traps()).filter((t) => t.kind === "wake").map((t) => t.detail);
    assert.deepEqual(wake, ["request screen", "release"]);
    await f.context.close();
  });

  it("without a wake lock, the code page says to set the screen to stay on", async () => {
    const f = await openCompanion(browser, { width: 390, height: 844, wake: "absent" });
    await f.page.waitForSelector("text=Set your screen to stay on");
    await f.context.close();
  });

  it("runs under the backend's CSP alone: no inline script, no eval, no referrer", async () => {
    const f = await connected(FOLLOWING);
    const r = await f.page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "globalThis.__inline = 1";
      document.head.append(s);
      const metas = [...document.querySelectorAll("meta[http-equiv]")].filter((m) => m.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy").length;
      const referrer = document.querySelector("meta[name=referrer]")?.getAttribute("content") ?? "";
      return { inline: (globalThis as { __inline?: number }).__inline ?? 0, referrer: document.referrer, metas, referrerMeta: referrer };
    });
    assert.deepEqual(r, { inline: 0, referrer: "", metas: 0, referrerMeta: "no-referrer" });
    // The CSP has no unsafe-eval, and the bundle needs none.
    const bundle = readFileSync(join(DIST, "control", "companion.js"), "utf8");
    assert.doesNotMatch(bundle, /\beval\(|new Function\(|\bFunction\(/);
    assert.ok((await f.traps()).some((t) => t.kind === "csp"), "the attempts were refused by the CSP");
    await f.context.close();
  });

  it("has no content security policy of its own: the backend's header policy is the only one", async () => {
    // A <meta> policy cannot name the site's origin for connect-src, so it could only be looser than
    // the header (control_page_policy.py); the two would apply together and the meta would add nothing.
    for (const p of [join(WEB_DIR, "src", "companion", "index.html"), join(DIST, "control", "index.html")]) {
      const html = readFileSync(p, "utf8");
      // Read by tokenizing the page (test/lib/html-meta.ts), so an entity-encoded name cannot slip by.
      assert.equal(hasPolicyMeta(html), false, p);
      assert.deepEqual(referrerMetas(html), ["no-referrer"], p);
    }
    // The page itself is served with the fake's header policy, which companion-fake-headers.test.ts
    // ties to the backend's text.
    const f = await openCompanion(browser, { width: 390, height: 844 });
    const [page] = await Promise.all([f.page.waitForResponse((res) => new URL(res.url()).pathname === "/control"), f.page.reload()]);
    assert.equal(page.headers()["content-security-policy"], controlCsp(ORIGIN));
    assert.equal(page.headers()["referrer-policy"], "no-referrer");
    await f.context.close();
  });
});

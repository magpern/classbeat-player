// The companion's tries after a dropped connection (companion.md, "Not connected"), on the fake
// live process with Playwright's paused clock: after 1 s, then 2 s, then every 5 s; the waits start
// again only after a welcomed connection stayed up 10 s, so a server that welcomes and then closes
// at once is not tried every second (review N1 on #261).
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { launchOffline, openCompanion } from "../lib/companion-fake.ts";
import type { Fake } from "../lib/companion-fake.ts";
import { SECRET43, examples } from "../lib/live-examples.ts";

const TOKEN = `cbp_ctl_${SECRET43}`;
const STATE = examples("companion-state", "valid").find((e) => e.name.endsWith("/following-locked.json"))?.value;
const SLACK = 40;

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

async function until(test: () => boolean, what: string): Promise<void> {
  for (let k = 0; k < 100; k += 1) {
    if (test()) return;
    await sleep(20);
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The next try comes `wait` ms after the last close: not SLACK ms before it, and by SLACK ms after it. */
async function nextTryAfter(f: Fake, wait: number): Promise<void> {
  const n = f.live.urls.length;
  await f.page.clock.runFor(wait - SLACK);
  await sleep(150);
  assert.equal(f.live.urls.length, n, `no try before ${wait} ms`);
  await f.page.clock.runFor(2 * SLACK);
  await until(() => f.live.urls.length === n + 1, `a try at ${wait} ms`);
}

async function connected(): Promise<Fake> {
  const f = await openCompanion(browser, { width: 390, height: 844, stored: TOKEN, clock: true });
  await f.page.clock.runFor(100);
  f.live.send(STATE);
  await f.page.waitForSelector(".run .count");
  return f;
}

describe("companion tries again: the waits", () => {
  it("after 1 s, 2 s, then every 5 s while the connection cannot be made", async () => {
    const f = await connected();
    f.live.refuse = true;
    await f.live.close(1006);
    for (const wait of [1000, 2000, 5000, 5000, 5000]) await nextTryAfter(f, wait);
    await f.context.close();
  });

  it("a server that welcomes and then closes at once is not tried every second", async () => {
    const f = await connected();
    await f.live.close(1008);
    for (const wait of [1000, 2000, 5000, 5000]) {
      await nextTryAfter(f, wait);
      // The new connection's hello is answered with a welcome; the page reads it, then it is closed.
      await until(() => f.live.sent.length === f.live.urls.length, "the hello");
      await sleep(100);
      await f.live.close(1008);
    }
    await f.context.close();
  });

  it("a connection that stayed up 10 s starts the waits again from 1 s", async () => {
    const f = await connected();
    f.live.refuse = true;
    await f.live.close(1006);
    await nextTryAfter(f, 1000);
    await nextTryAfter(f, 2000);
    f.live.refuse = false;
    await nextTryAfter(f, 5000);
    await until(() => f.live.sent.length === 2, "the hello");
    await sleep(100);
    // Up and welcomed for 10 s, with states coming (no watchdog restart).
    for (let k = 1; k <= 5; k += 1) {
      await f.page.clock.runFor(2000);
      f.live.send({ ...(STATE as object), seq: 41 + k });
      await sleep(50);
    }
    await f.live.close(1006);
    await nextTryAfter(f, 1000);
    await f.context.close();
  });
});

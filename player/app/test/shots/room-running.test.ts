// The room window of a running class (ADR 0015 section 2, running-class.md): the real room page in
// headless Chrome, given the frame the shell builds from the valid treadmill example (read, started
// on the manual clock, framed for the room window). The page shows the incline target and the next
// row's incline, never a cadence or a seated/standing position. A screenshot per state goes to
// screenshots/room-running-<state>.png. No music link, no network. Needs `npm run build`.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { INITIAL, command, openText, snapshotOf } from "../../src/core/player-state.ts";
import { roomFrameOf } from "../../src/core/room/frame.ts";
import { classSchema, EXAMPLES } from "../unit/fixtures.ts";
import { launchChrome, SHOT_DIR } from "./page.ts";
import { openRoom } from "./room-page.ts";

const FILE = "class-running-treadmill.json";
const TEXT = readFileSync(join(EXAMPLES, "valid", FILE), "utf8");

/** The frame the shell sends the room window `ms` into the running class (manual clock, no music link). */
function frameAt(ms: number) {
  let s = openText(INITIAL, FILE, TEXT, classSchema, 1_000);
  s = command(s, { type: "start" }, 1_000);
  return roomFrameOf(snapshotOf(s, 1_000 + ms));
}

let browser: Browser;
before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const STATES = [
  { name: "flat", ms: 60_000, incline: "Incline flat", next: "Incline raised" },
  { name: "raised", ms: 400_000, incline: "Incline raised", next: "Incline flat" },
] as const;

for (const st of STATES) {
  test(`running class room window, ${st.name}: the incline target and the next row's incline, no cadence or position`, { timeout: 120_000 }, async () => {
    const o = await openRoom(browser, { size: [1920, 1080], frame: frameAt(st.ms), remote: { slot: "absent" } });
    try {
      await o.page.screenshot({ path: join(SHOT_DIR, `room-running-${st.name}.png`) });
      const metrics = await o.page.locator(".metric").allTextContents();
      assert.ok(metrics.some((t) => t.includes("Target") && t.includes(st.incline)), metrics.join(" | "));
      assert.ok(!metrics.some((t) => /cadence|rpm/i.test(t)), `no cadence: ${metrics.join(" | ")}`);
      assert.ok(!metrics.some((t) => /position|seated|standing/i.test(t)), `no position: ${metrics.join(" | ")}`);
      const next = (await o.page.locator(".nline").allTextContents()).join(" ");
      assert.ok(next.includes(st.next), next);
      assert.ok(!/rpm|seated|standing/i.test(next), next);
      assert.deepEqual(o.errors, []);
      assert.deepEqual(o.external, [], "nothing leaves the file system");
    } finally {
      await o.close();
    }
  });
}

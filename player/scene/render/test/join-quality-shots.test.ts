// The join-quality shot tool's own check (tools/join-quality-shots.ts), with no browser: the run keeps a page error raised after
// its last check, that is, one that only the page's close brings.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "playwright-core";
import { QUALITY } from "../../model/src/index.ts";
import { joinStepsTheQuality } from "../tools/join-quality-shots.ts";

/** A browser whose page plays every check right (the canvas at High, Medium, Low, then the plain screen, and no violation) and
 *  whose close raises `late` through the page's own `pageerror` listener, as a late frame would. */
function browserWith(late: string | null): Browser {
  const listeners = new Map<string, (e: unknown) => void>();
  const states = (["High", "Medium", "Low"] as const).flatMap((l) => Array.from({ length: 5 }, () => ({ width: Math.floor(960 * QUALITY[l].renderScale), height: 540, mode: "scene", why: null as string | null, level: l })));
  states.push({ ...states.at(-1)!, mode: "off", why: "too slow" });
  const page = {
    on: (name: string, fn: (e: unknown) => void) => { listeners.set(name, fn); },
    addInitScript: async () => undefined,
    goto: async () => null,
    waitForFunction: async () => undefined,
    evaluate: async (_fn: unknown, arg?: unknown) => (typeof arg === "number" ? states : []),
    close: async () => { if (late !== null) listeners.get("pageerror")?.(new Error(late)); },
  };
  return { newPage: async () => page } as unknown as Browser;
}

test("a clean join page passes", async () => {
  await joinStepsTheQuality(browserWith(null));
});

test("a page error raised by the close fails the run", async () => {
  await assert.rejects(joinStepsTheQuality(browserWith("late")), (e: Error) => {
    assert.ok(e.message.includes("the join page raised errors"));
    assert.deepEqual((e as { actual?: unknown }).actual, ["page error: late"]);
    return true;
  });
});

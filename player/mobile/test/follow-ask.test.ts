// Follow's access ask (room/follow-ask.ts; app-follow.md, "States"): access is checked at the press
// and only then, the sheet asks without it, and coming back from Android's setting checks again.
// The access answer, the setting and the sheet are fakes: no phone, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFollowAsk, type SheetKind } from "../src/room/follow-ask.ts";

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function setup(answer: () => Promise<unknown>) {
  const calls: string[] = [];
  let shown: SheetKind | null = null;
  const shows: SheetKind[] = [];
  const returns: (() => void)[] = [];
  let on = 0;
  const ask = createFollowAsk({
    access: () => (calls.push("access"), answer()),
    openSetting: () => (calls.push("openSetting"), Promise.resolve({ opened: true })),
    sheet: { show: (k) => void (shown = k, shows.push(k)), hide: () => void (shown = null), isOpen: () => shown !== null },
    onReturn: (fn) => void returns.push(fn),
  });
  return {
    ask,
    calls,
    shows,
    sheet: () => shown,
    turnedOn: () => on,
    press: () => ask.press(() => void on++),
    back: () => returns.forEach((fn) => fn()),
  };
}

test("with access, Follow turns following on at once and shows no sheet", async () => {
  const t = setup(() => Promise.resolve({ granted: true }));
  t.press();
  await flush();
  assert.equal(t.turnedOn(), 1);
  assert.equal(t.sheet(), null);
  assert.deepEqual(t.calls, ["access"]);
});

test("without access, the sheet asks; a refusal, a failure or a garbled answer all count as no access", async () => {
  for (const answer of [() => Promise.resolve({ granted: false }), () => Promise.reject(new Error("x")), () => Promise.resolve({ granted: "yes" }), () => Promise.resolve(null)]) {
    const t = setup(answer);
    t.press();
    await flush();
    assert.equal(t.sheet(), "ask");
    assert.equal(t.turnedOn(), 0);
  }
});

test("presses while the sheet shows or a check is out ask nothing more", async () => {
  const t = setup(() => Promise.resolve({ granted: false }));
  t.press();
  t.press();
  await flush();
  t.press();
  await flush();
  assert.deepEqual(t.calls, ["access"]);
});

test("back from the setting with access: the sheet closes by itself and following goes on", async () => {
  let granted = false;
  const t = setup(() => Promise.resolve({ granted }));
  t.press();
  await flush();
  t.ask.openSetting();
  granted = true;
  t.back();
  await flush();
  assert.equal(t.sheet(), null);
  assert.equal(t.turnedOn(), 1);
  assert.deepEqual(t.calls, ["access", "openSetting", "access"]);
});

test("back from the setting still without access: the sheet says how; Not now keeps the clock manual", async () => {
  const t = setup(() => Promise.resolve({ granted: false }));
  t.press();
  await flush();
  t.ask.openSetting();
  t.back();
  await flush();
  assert.deepEqual(t.shows, ["ask", "still-off"]);
  t.ask.notNow();
  assert.equal(t.sheet(), null);
  assert.equal(t.turnedOn(), 0);
});

test("the app coming back checks again only after Open the setting, and only while the sheet shows", async () => {
  const t = setup(() => Promise.resolve({ granted: false }));
  t.back();
  t.press();
  await flush();
  t.back();
  await flush();
  assert.deepEqual(t.calls, ["access"], "back without going to the setting");
  t.ask.openSetting();
  t.ask.notNow();
  t.back();
  await flush();
  assert.deepEqual(t.calls, ["access", "openSetting"], "back after Not now");
  // Open the setting does nothing with no sheet.
  t.ask.openSetting();
  assert.deepEqual(t.calls, ["access", "openSetting"]);
});

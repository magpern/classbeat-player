// When the displays are checked (#353, #381; main/live/displays.ts): a display removed and a
// change of a display's metrics (how mirroring shows) each run the live service's display check,
// so with only one display left the control code held is cancelled at once, not at the next poll.
// A fake `screen` stands in for Electron's; setup.ts is asserted on its source, as it needs
// Electron. Fakes only, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DISPLAY_EVENTS, watchDisplays } from "../../src/main/live/displays.ts";
import type { DisplayEvent } from "../../src/main/live/displays.ts";
import { CONTROL_CODE, started } from "./live-relay.ts";

function fakeScreen(): { on(event: DisplayEvent, listener: () => void): void; emit(event: string): void } {
  const listeners = new Map<string, (() => void)[]>();
  return {
    on: (event, listener) => void listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    emit: (event) => listeners.get(event)?.forEach((l) => l()),
  };
}

test("display-removed and display-metrics-changed each run the display check, other events do not", () => {
  assert.deepEqual([...DISPLAY_EVENTS].sort(), ["display-metrics-changed", "display-removed"]);
  const screen = fakeScreen();
  let checks = 0;
  watchDisplays(screen, () => void (checks += 1));
  screen.emit("display-metrics-changed");
  assert.equal(checks, 1);
  screen.emit("display-removed");
  assert.equal(checks, 2);
  screen.emit("display-added");
  assert.equal(checks, 2);
});

test("display-metrics-changed with the displays mirrored: the control code ends here and on the server at once", async () => {
  const r = await started();
  const screen = fakeScreen();
  watchDisplays(screen, () => r.live.displaysChanged());
  r.live.makeCode();
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  const cancels = (): unknown[] => r.socket().sent.filter((m) => (m as { type?: string }).type === "cancel_code");
  // Still two displays: the event changes nothing.
  screen.emit("display-metrics-changed");
  assert.deepEqual(cancels(), []);
  // Mirrored: one display is left. No view, tick or poll runs; the event alone cancels.
  r.secondDisplay = false;
  screen.emit("display-metrics-changed");
  assert.deepEqual(cancels(), [{ v: 1, type: "cancel_code" }]);
});

test("setup.ts watches Electron's screen through watchDisplays, into the live service's check", () => {
  const setup = readFileSync(new URL("../../src/main/live/setup.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(setup, /watchDisplays\(screen,\s*\(\)\s*=>\s*live\.displaysChanged\(\)\)/);
  assert.doesNotMatch(setup, /screen\.on\(/, "every display event goes through watchDisplays");
});

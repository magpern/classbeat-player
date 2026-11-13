// Check C10's behaviour (room-2d.md, "Checks", "Behaviour, PL4 CI only") and the room window's keys,
// on the real room page in headless Chrome with Playwright's clock: what shows and hides the band,
// what a press does while it is hidden or fading, and which fixed command each press or key sends.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { launchChrome } from "./page.ts";
import { frameOf, on, openRoom, ROUTES, wiggle } from "./room-page.ts";
import type { RoomOpen, RoomOpenOptions } from "./room-page.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const SIZE: readonly [number, number] = [1920, 1080];
const RUNNING = frameOf("running", ROUTES.following);

async function room(o: Partial<RoomOpenOptions>, body: (r: RoomOpen) => Promise<void>): Promise<void> {
  const r = await openRoom(browser, { size: SIZE, frame: RUNNING, remote: on(1), ...o });
  try {
    await body(r);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.external, []);
  } finally {
    await r.close();
  }
}

/** The centre of a band button, in page pixels. */
async function at(r: RoomOpen, id: string): Promise<{ x: number; y: number }> {
  const b = await r.page.locator(`.band [data-id="${id}"]`).boundingBox();
  assert.ok(b, id);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Moves the pointer onto a button and waits until the band has hidden, so the next press finds it hidden. */
async function restOnHidden(r: RoomOpen, id: string): Promise<{ x: number; y: number }> {
  await wiggle(r.page);
  const p = await at(r, id);
  await r.page.mouse.move(p.x, p.y);
  await r.run(3400);
  assert.equal(await r.phase(), "hidden");
  return p;
}

test("it hides 3 s after a pointer move, fading out over 300 ms; a nudge of the table does not show it", async () => {
  await room({}, async (r) => {
    assert.equal(await r.phase(), "hidden");
    await r.page.mouse.move(400, 300);
    await r.page.mouse.move(403, 303);
    assert.equal(await r.phase(), "hidden", "a 4 px move");
    await wiggle(r.page);
    assert.equal(await r.phase(), "shown");
    await r.run(2950);
    assert.equal(await r.phase(), "shown");
    await r.run(60);
    assert.equal(await r.phase(), "fading");
    await r.run(310);
    assert.equal(await r.phase(), "hidden");
  });
});

test("each kind of input restarts the 3 s: a key press too", async () => {
  await room({}, async (r) => {
    await wiggle(r.page);
    await r.run(2000);
    await r.page.keyboard.press("a");
    await r.run(2500);
    assert.equal(await r.phase(), "shown");
    await r.run(600);
    assert.equal(await r.phase(), "fading");
  });
});

test("a pointer resting over the band does not hold it", async () => {
  await room({}, async (r) => {
    await wiggle(r.page);
    const p = await at(r, "main");
    await r.page.mouse.move(p.x, p.y);
    await r.run(3050);
    assert.equal(await r.phase(), "fading");
  });
});

test("a click on a shown button presses it once, and the band still hides 3 s later", async () => {
  await room({}, async (r) => {
    await wiggle(r.page);
    for (const id of ["main", "next", "previous"]) {
      const p = await at(r, id);
      await r.page.mouse.click(p.x, p.y);
    }
    assert.deepEqual(await r.calls(), ["pause", "next", "previous"]);
    await r.run(3050);
    assert.equal(await r.phase(), "fading");
  });
});

test("a click while hidden, or during the fade-out, presses nothing and only shows the band", async () => {
  await room({}, async (r) => {
    const p = await restOnHidden(r, "main");
    await r.page.mouse.down();
    await r.page.mouse.up();
    assert.equal(await r.phase(), "shown");
    assert.deepEqual(await r.calls(), []);
    await r.run(3100);
    assert.equal(await r.phase(), "fading");
    await r.page.mouse.down();
    await r.page.mouse.up();
    assert.equal(await r.phase(), "shown");
    assert.deepEqual(await r.calls(), []);
    await r.page.mouse.click(p.x, p.y);
    assert.deepEqual(await r.calls(), ["pause"]);
  });
});

test("on touch a tap is the only way in: the first tap shows the band, the next one presses", async () => {
  await room({ touch: true }, async (r) => {
    await wiggle(r.page);
    const p = await at(r, "main");
    await r.run(3400);
    assert.equal(await r.phase(), "hidden");
    await r.page.touchscreen.tap(p.x, p.y);
    assert.equal(await r.phase(), "shown");
    assert.deepEqual(await r.calls(), []);
    await r.page.touchscreen.tap(p.x, p.y);
    assert.deepEqual(await r.calls(), ["pause"]);
    await r.run(3050);
    assert.equal(await r.phase(), "fading");
  });
});

test("keyboard focus reached by Tab holds it until Esc", async () => {
  await room({}, async (r) => {
    await r.page.keyboard.press("Tab");
    assert.equal(await r.phase(), "shown");
    assert.equal(await r.page.evaluate(() => (document.activeElement as HTMLElement).dataset.id), "previous");
    await r.page.keyboard.press("Tab");
    assert.equal(await r.page.evaluate(() => (document.activeElement as HTMLElement).dataset.id), "main");
    await r.run(60_000);
    assert.equal(await r.phase(), "shown");
    await r.page.keyboard.press("Enter");
    assert.deepEqual(await r.calls(), ["pause"]);
    await r.page.keyboard.press("Escape");
    await r.run(310);
    assert.equal(await r.phase(), "hidden");
  });
});

test("End asks; the question holds the band until answered; Esc and Keep going close it; End class ends", async () => {
  await room({}, async (r) => {
    await r.page.keyboard.press("End");
    assert.equal(await r.phase(), "shown");
    assert.equal(await r.page.evaluate(() => (document.activeElement as HTMLElement).dataset.id), "keep-going");
    await r.run(7000);
    assert.equal(await r.page.locator(".band .ask").count(), 1);
    await r.page.keyboard.press("Escape");
    assert.equal(await r.page.locator(".band .ask").count(), 0);
    await r.run(3050);
    assert.equal(await r.phase(), "fading");
    // Enter answers the focused Keep going.
    await r.page.keyboard.press("End");
    await r.page.keyboard.press("Enter");
    assert.equal(await r.page.locator(".band .ask").count(), 0);
    // Unanswered, it closes by itself after 8 s.
    await r.page.keyboard.press("End");
    await r.run(8050);
    assert.equal(await r.page.locator(".band .ask").count(), 0);
    await r.page.keyboard.press("End");
    const p = await at(r, "end-class");
    await r.page.mouse.click(p.x, p.y);
    assert.deepEqual(await r.calls(), ["endClass"]);
  });
});

test("a click on End only asks: it calls nothing, and End class needs its own press", async () => {
  await room({}, async (r) => {
    await wiggle(r.page);
    const p = await at(r, "end");
    await r.page.mouse.click(p.x, p.y);
    assert.equal(await r.page.locator(".band .ask").count(), 1);
    assert.deepEqual(await r.calls(), []);
    assert.equal(await r.phase(), "shown");
  });
});

test("a tap on End only asks too", async () => {
  await room({ touch: true }, async (r) => {
    const p = await restOnHidden(r, "end");
    await r.page.touchscreen.tap(p.x, p.y);
    assert.equal(await r.page.locator(".band .ask").count(), 0, "the first tap only shows the band");
    await r.page.touchscreen.tap(p.x, p.y);
    assert.equal(await r.page.locator(".band .ask").count(), 1);
    assert.deepEqual(await r.calls(), []);
  });
});

test("a double-click on End lands on Keep going: nothing is called and the question closes", async () => {
  await room({}, async (r) => {
    await wiggle(r.page);
    const p = await at(r, "end");
    await r.page.mouse.dblclick(p.x, p.y);
    assert.equal(await r.page.locator(".band .ask").count(), 0);
    assert.deepEqual(await r.calls(), []);
    // A nervous triple click: the third opens the question again, and still nothing ends.
    await r.page.mouse.click(p.x, p.y, { clickCount: 3 });
    assert.deepEqual(await r.calls(), []);
  });
});

test("while the End question is open, Space and the arrows do nothing; Esc answers it first", async () => {
  await room({}, async (r) => {
    await r.page.keyboard.press("End");
    for (const k of [" ", "ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Shift+ArrowRight", "Shift+ArrowLeft"]) await r.page.keyboard.press(k);
    assert.deepEqual(await r.calls(), []);
    assert.equal(await r.page.locator(".band .ask").count(), 1);
    await r.page.keyboard.press("Escape");
    await r.page.keyboard.press(" ");
    assert.deepEqual(await r.calls(), ["pause"]);
  });
});

test("with one display it stays up before the start and on Class Complete; with two it hides", async () => {
  for (const fixture of ["before-start", "finished"]) {
    await room({ frame: frameOf(fixture) }, async (r) => {
      assert.equal(await r.phase(), "shown", fixture);
      await r.run(60_000);
      await r.page.keyboard.press("Escape");
      await r.run(400);
      assert.equal(await r.phase(), "shown", fixture);
    });
    await room({ frame: frameOf(fixture), alone: false }, async (r) => {
      assert.equal(await r.phase(), "hidden", fixture);
    });
  }
  await room({ frame: frameOf("finished") }, async (r) => {
    const p = await at(r, "close");
    await r.page.mouse.click(p.x, p.y);
    assert.deepEqual(await r.calls(), ["endClass"]);
  });
});

test("with reduced motion it appears and hides in 0 ms", async () => {
  await room({ reducedMotion: true }, async (r) => {
    await wiggle(r.page);
    assert.equal(await r.page.evaluate(() => getComputedStyle(document.querySelector(".band")!).transitionDuration), "0s");
    await r.run(3000);
    assert.equal(await r.phase(), "hidden");
  });
});

test("Space, the arrows, Page Up and Down, Ctrl+Z and F work without showing the band", async () => {
  await room({}, async (r) => {
    for (const k of [" ", "ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Shift+ArrowRight", "Shift+ArrowLeft", "Control+z", "f"]) await r.page.keyboard.press(k);
    assert.deepEqual(await r.calls(), ["pause", "next", "previous", "next", "previous", "forward", "back", "undo", "follow"]);
    assert.equal(await r.phase(), "hidden");
  });
});

test("F does nothing where the music cannot be followed", async () => {
  await room({ frame: frameOf("running", ROUTES.clock, false) }, async (r) => {
    await r.page.keyboard.press("f");
    assert.deepEqual(await r.calls(), []);
  });
});

test("a clicker: F5 and Shift+F5 are Start only before the start; B and '.' do nothing; a held key repeats nothing", async () => {
  await room({}, async (r) => {
    for (const k of ["F5", "Shift+F5", "b", "B", "."]) await r.page.keyboard.press(k);
    await r.page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: true, bubbles: true })));
    assert.deepEqual(await r.calls(), []);
    assert.equal(await r.phase(), "hidden");
  });
  await room({ frame: frameOf("before-start"), alone: false }, async (r) => {
    await r.page.keyboard.press("F5");
    assert.deepEqual(await r.calls(), ["start"]);
  });
});

test("the Phone remote button asks for the remote; the slot's answers redraw the code", async () => {
  await room({ remote: { slot: "available", note: "none" } }, async (r) => {
    await wiggle(r.page);
    const p = await at(r, "remote");
    await r.page.mouse.click(p.x, p.y);
    assert.deepEqual(await r.calls(), ["startRemote"]);
    await r.pushRemote(on(0));
    assert.equal(await r.page.locator(".band .code-t .v").textContent(), "KXPD-RMTB");
    assert.equal(await r.page.locator(".band svg.qr").count(), 1);
    await r.pushRemote({ slot: "on", joinCode: "KXPD-RMTB", phones: 0, reconnecting: false });
    assert.equal(await r.page.locator(".band svg.qr").count(), 0, "no site, no QR code");
  });
});

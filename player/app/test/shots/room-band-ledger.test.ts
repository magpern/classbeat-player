// Every visible change of the control band and the join sheet is drawn inside a mark of the room screen's one ledger
// (`screen.requestMark`, #609). A probe in the real room page wraps `requestMark`, and a MutationObserver on the band,
// the sheet and the body's `data-band` / `data-join` attributes counts every change: those made inside a mark's draw,
// and those made outside one. A change drawn without the ledger fails this test.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { launchChrome } from "./page.ts";
import { frameOf, on, openRoom, ROUTES, wiggle } from "./room-page.ts";

let browser: Browser;
before(async () => {
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

const PROBE = `
  window.__ledger = { marks: 0, inside: 0, outside: [] };
  const mine = (r) => {
    const t = r.target;
    const el = t.nodeType === 1 ? t : t.parentElement;
    if (!el) return false;
    if (el.closest && el.closest(".band, .join")) return !(r.type === "childList" && el === document.body);
    return el === document.body && (r.attributeName === "data-band" || r.attributeName === "data-join");
  };
  // A change of what a hidden band holds is not seen by anyone; one that shows or hides it, or touches the sheet, is.
  const unseen = (r) => {
    const band = document.querySelector(".band");
    return band !== null && band.dataset.phase === "hidden" && band.contains(r.target) && !(r.target === band && r.type === "attributes");
  };
  const obs = new MutationObserver((records) => {
    for (const r of records) if (mine(r) && !unseen(r)) window.__ledger.outside.push(r.type + ":" + (r.attributeName || (r.target.className || r.target.nodeName)));
  });
  obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  let mounted;
  Object.defineProperty(window, "classbeatRoom", {
    configurable: true,
    get: () => mounted,
    set: (v) => {
      mounted = {
        mount(host, opts) {
          const screen = v.mount(host, opts);
          const request = screen.requestMark.bind(screen);
          screen.requestMark = (draw) => {
            window.__ledger.marks++;
            return request(() => {
              draw();
              window.__ledger.inside += obs.takeRecords().filter(mine).length;
            });
          };
          return screen;
        },
      };
    },
  });
`;

test("every visible change of the band and the sheet is drawn inside a mark of the room's ledger", async () => {
  const r = await openRoom(browser, { size: [1280, 720], frame: frameOf("before-start", ROUTES.following), remote: on(1), alone: false, init: PROBE });
  try {
    await r.run(600);
    await wiggle(r.page); // the band appears
    await r.run(600);
    await r.page.keyboard.press("j"); // the sheet closes
    await r.run(600);
    await r.page.keyboard.press("End"); // the End question
    await r.run(600);
    await r.page.keyboard.press("Escape");
    await r.run(600);
    await r.pushRemote({ slot: "on", joinCode: "WXYZ-1234", phones: 0, reconnecting: false, site: "https://classbeat.example" });
    await r.run(4000); // the band goes by itself
    const l = await r.page.evaluate(() => (window as unknown as { __ledger: { marks: number; inside: number; outside: string[] } }).__ledger);
    assert.ok(l.marks >= 5, `${l.marks} marks asked of the ledger`);
    assert.ok(l.inside >= 5, `${l.inside} changes drawn inside a mark`);
    assert.deepEqual(l.outside, [], "changes drawn outside the ledger");
    assert.deepEqual([r.errors, r.external], [[], []]);
  } finally {
    await r.close();
  }
});

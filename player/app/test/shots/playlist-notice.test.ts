// The presenter's "playlist not loaded" notice (#488, ADR 0001 "Start loads the class playlist"),
// on the real presenter page (dist/presenter.html) in headless Chrome. The snapshots come from the
// real controller with a fake follower; the page gets them through a stand-in for the shell's
// bridge. Screenshots go to screenshots/ for the Designer. No Electron, no network. Needs
// `npm run build`.
//   npm run test:shots            (SHOTS_ONLY=<regex> limits it to matching "<state>-<w>x<h>")
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import type { LoadOutcome } from "../../src/core/link/playlist.ts";
import type { Observation } from "../../src/core/link/types.ts";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { createController } from "../../src/main/controller.ts";
import { CONVERTER_FIXTURES } from "../unit/fixtures.ts";
import { PAIRED } from "../unit/list-fixtures.ts";
import { APP_DIR, launchChrome, SHOT_DIR } from "./page.ts";

const SIZES: readonly (readonly [number, number])[] = [[1280, 800], [1000, 720]];
const WITH = readFileSync(join(CONVERTER_FIXTURES, "class-30min-spotify-playlist.expected.json"), "utf8");
const doc = JSON.parse(WITH) as { music: Record<string, unknown>; songs: { title: string; artist: string; length_ms: number }[] };
const WITHOUT = JSON.stringify({ ...doc, music: { ...doc.music, spotify_playlist: undefined } });
const NOTICE = "Playlist not loaded Start played what Spotify had loaded";

/** The snapshot 2 s after Start, with the follower answering `outcome` and then reading `title`. */
function started(text: string, outcome: LoadOutcome, title: string | null, at = 3000, manual = false): Snapshot {
  const clock = { t: 1000 };
  let obs: Observation | null = null;
  const s0 = doc.songs[0];
  const f = { kind: "fake" as const, latest: () => obs, send: () => undefined, loadPlaylist: (_id: string, done: (o: LoadOutcome) => void) => done(outcome) };
  // A follower with `setActive` (macOS-like) opens a class on the manual clock; one without follows.
  const g = manual ? Object.assign({ ...f }, { setActive: () => undefined }) : f;
  const c = createController(() => clock.t, g, g);
  c.open("class.json", text);
  c.command({ type: "start" });
  clock.t = 1500;
  if (title !== null) obs = { title, artist: title === s0.title ? s0.artist : "Someone", lengthMs: s0.length_ms, positionMs: 400, playing: true, at: 1500, seenAt: 1500 };
  c.snapshot();
  clock.t = at;
  if (obs) obs = { ...obs, positionMs: 1900, at, seenAt: at };
  return c.snapshot();
}

const STATES: readonly { readonly name: string; readonly snap: () => Snapshot; readonly shown: boolean }[] = [
  { name: "not-loaded", snap: () => started(WITH, "failed", doc.songs[0].title), shown: true },
  { name: "no-playlist", snap: () => started(WITHOUT, "asked", doc.songs[0].title), shown: true },
  { name: "fault-wins", snap: () => started(WITH, "asked", "Something else"), shown: false },
  { name: "loaded", snap: () => started(WITH, "asked", doc.songs[0].title), shown: false },
  { name: "after-30s", snap: () => started(WITH, "failed", doc.songs[0].title, 1000 + 30_000), shown: false },
  { name: "manual-clock", snap: () => started(WITH, "failed", doc.songs[0].title, 3000, true), shown: false },
];

const STUB = `
  const none = () => Promise.resolve(null);
  window.player = {
    getState: () => Promise.resolve(window.__state),
    command: () => Promise.resolve(window.__state),
    openDropped: () => Promise.resolve(window.__state),
    onUpdate: () => undefined,
    startPairing: () => Promise.resolve(window.__pairing),
    pairingState: () => Promise.resolve(window.__pairing),
    reopenPairingPage: () => Promise.resolve(window.__pairing),
    unpair: () => Promise.resolve(window.__pairing),
    liveView: none, startLive: none, endLive: none, makeControlCode: none, dropPhone: none,
    riders: none, dropRider: none, lockJoining: none, newJoinCode: none,
  };
`;

let browser: Browser;
const only = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;

before(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  browser = await launchChrome();
});
after(async () => {
  await browser?.close();
});

test("the playlist notice shows only when the class's playlist was not loaded", { timeout: 120_000 }, async () => {
  for (const s of STATES) {
    const snap = s.snap();
    assert.equal(snap.link?.playlistNotLoaded, s.shown, s.name);
    for (const size of SIZES) {
      const name = `${s.name}-${size[0]}x${size[1]}`;
      if (only && !only.test(name)) continue;
      const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1, reducedMotion: "reduce" });
      try {
        await context.addInitScript("globalThis.__name = (f) => f;");
        await context.addInitScript(STUB);
        await context.addInitScript(`window.__state = ${JSON.stringify(snap)}; window.__pairing = ${JSON.stringify(PAIRED)};`);
        const page = await context.newPage();
        const external: string[] = [];
        const errors: string[] = [];
        page.on("request", (r) => void (r.url().startsWith("file:") || external.push(r.url())));
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`file://${join(APP_DIR, "dist", "presenter.html")}`);
        await page.waitForSelector("#link:not([hidden])");
        await page.locator("#link").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(SHOT_DIR, `presenter-playlist-${name}.png`), fullPage: true, animations: "disabled" });
        const notice = page.locator("#link-playlist");
        assert.equal(await notice.isVisible(), s.shown, `${name}: the notice`);
        assert.equal((await notice.textContent())?.replace(/\s+/g, " ").trim(), NOTICE);
        assert.equal(await page.locator("#link-line").isVisible(), !s.shown, `${name}: the notice takes the link state's place`);
        assert.equal(await notice.getAttribute("role"), "status", "read out when it appears");
        assert.deepEqual(external, [], `${name}: requests left the file system`);
        assert.deepEqual(errors, [], `${name}: page errors`);
      } finally {
        await context.close();
      }
    }
  }
});

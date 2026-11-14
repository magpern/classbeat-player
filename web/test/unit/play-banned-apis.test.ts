// Guard (ADR 0008, section 6): no module in the web player page's bundle names an API of the banned
// list: media elements and media APIs, `navigator.mediaSession`, `navigator.mediaDevices`,
// `navigator.bluetooth`, `WebSocket`, `EventSource`, the storage APIs, `navigator.serviceWorker`, and an
// `audio` or `video` element made by name. "Every module in the bundle" is the list esbuild itself
// reports for the build the page ships (its metafile): the play code, the room modules it includes,
// the site modules it takes and the three clock files. Each is read from its syntax tree.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { build } from "esbuild";
import { WEB_DIR } from "../lib/browser.ts";
import { bannedApis, BANNED } from "../lib/play-banned.ts";

/** The modules of the page's script, as the shipped build reads them. */
async function bundleModules(): Promise<string[]> {
  const result = await build({
    absWorkingDir: WEB_DIR,
    entryPoints: { play: "src/play/main.ts" },
    bundle: true,
    format: "iife",
    target: "chrome130",
    outdir: "unused",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  return Object.keys(result.metafile.inputs).filter((f) => /\.ts$/.test(f));
}

describe("banned APIs in the play bundle", () => {
  it("the bundle takes the play code, the room, the site and the three clock files", async () => {
    const modules = await bundleModules();
    for (const part of ["src/play/player.ts", "src/room/mount.ts", "src/site/net/api.ts", "player/app/src/core/clock/clock.ts", "player/app/src/core/clock/plan.ts", "player/app/src/core/clock/view.ts"]) {
      assert.ok(modules.some((m) => m.endsWith(part)), `${part} is not in the bundle`);
    }
  });

  it("no module of the bundle names a banned API", async () => {
    const found: string[] = [];
    for (const m of await bundleModules()) for (const p of bannedApis(m, readFileSync(join(WEB_DIR, m), "utf8"))) found.push(`${m}: ${p}`);
    assert.deepEqual(found, []);
  });
});

describe("the banned-API guard catches each name of the list", () => {
  const caught = (src: string): number => bannedApis("m.ts", src).length;

  it("every name of ADR 0008's list, as a value or a member", () => {
    for (const name of BANNED) {
      assert.equal(caught(`const x = ${name};`), 1, name);
      assert.equal(caught(`const x = navigator.${name};`), 1, `navigator.${name}`);
      assert.equal(caught(`const x = window["${name}"];`), 1, `["${name}"]`);
    }
  });

  it("an audio or video element made by name, by any helper, or as markup", () => {
    assert.ok(caught('document.createElement("audio");') > 0);
    assert.ok(caught('document.createElement("video");') > 0);
    assert.ok(caught('document.createElementNS("http://www.w3.org/1999/xhtml", "AUDIO");') > 0);
    assert.ok(caught('el("video", {}, []);') > 0);
    assert.ok(caught("x.append(`<audio src=${u}></audio>`);") > 0);
    assert.ok(caught('x.append("<video></video>");') > 0);
  });

  it("an import of a banned name, a destructuring and a new instance", () => {
    assert.equal(caught("new Audio('x'); new WebSocket(u); new EventSource(u);"), 3);
    assert.equal(caught("const { localStorage } = window;"), 1);
    assert.equal(caught("navigator.serviceWorker.register('/sw.js');"), 1);
    assert.equal(caught("await navigator.mediaDevices.getUserMedia({ audio: true });"), 1);
  });

  it("what is allowed: the wake lock and fullscreen, a key or a comment that names one", () => {
    assert.equal(caught("// localStorage, navigator.mediaSession and new Audio() are banned\nnavigator.wakeLock.request('screen'); document.documentElement.requestFullscreen();"), 0);
    assert.equal(caught("const o = { caches: 1 }; interface I { mediaSession: string }"), 0);
    assert.equal(caught('const tag = "section"; document.createElement(tag);'), 0);
  });
});

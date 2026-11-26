// The room-CSS shot tool's own checks (tools/room-css-shots.ts), with no browser: `withImports` inlines the sheet's imports and refuses
// what it cannot inline, and the run keeps a page error raised after its last check.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Page } from "playwright-core";
import { pageStylesheetDoesNotReachTheCue, withImports } from "../tools/room-css-shots.ts";

const base = mkdtempSync(join(tmpdir(), "room-css-"));
after(() => rmSync(base, { recursive: true, force: true }));
const room = join(base, "room");
mkdirSync(room);
mkdirSync(join(base, "roomx"));
writeFileSync(join(room, "part.css"), ".part { top: 1px; }");
writeFileSync(join(base, "roomx", "evil.css"), ".evil { top: 2px; }");
writeFileSync(join(base, "outside.css"), ".outside { top: 3px; }");
let n = 0;
const sheet = (rule: string): string => { const f = join(room, `main-${n++}.css`); writeFileSync(f, `${rule}\n.main { top: 0; }`); return f; };

test("withImports inlines a quoted import and a quoted and an unquoted url() import", () => {
  for (const rule of ['@import "./part.css";', "@import './part.css';", '@import url("./part.css");', "@import url('./part.css');", "@import url(./part.css);"]) {
    const css = withImports(sheet(rule), room);
    assert.ok(css.includes(".part { top: 1px; }") && css.includes(".main") && !css.includes("@import"), rule);
  }
});

test("withImports refuses a sibling folder that only shares the root's name prefix", () => {
  assert.throws(() => withImports(sheet('@import "../roomx/evil.css";'), room), /not a relative sheet inside/);
});

test("withImports refuses a sheet outside the root, an absolute one and the root itself", () => {
  assert.throws(() => withImports(sheet('@import "../outside.css";'), room), /not a relative sheet inside/);
  assert.throws(() => withImports(sheet(`@import "${join(base, "outside.css")}";`), room), /not a relative sheet inside/);
  assert.throws(() => withImports(sheet('@import "./";'), room), /not a relative sheet inside/);
});

test("withImports refuses an import with a media, layer or supports condition instead of dropping it", () => {
  for (const rule of ['@import "./part.css" screen;', "@import url(./part.css) (min-width: 10px);", '@import url("./part.css") layer(base);', '@import "./part.css" supports(display: grid);']) {
    assert.throws(() => withImports(sheet(rule), room), /condition or a form that is not inlined/, rule);
  }
});

test("withImports still refuses a cycle and a missing sheet", () => {
  const a = join(room, "a.css");
  writeFileSync(a, '@import "./a.css";');
  assert.throws(() => withImports(a, room), /cycle/);
  assert.throws(() => withImports(sheet('@import "./nope.css";'), room), /ENOENT/);
});

/** A page whose every check passes (`evaluate` answers by what it is asked) and whose close raises one more error, as a late frame would. */
test("a page error raised after the last check fails the run", async () => {
  const endVh: Record<number, number> = { 1920: 68.4, 1440: 80.3, 1279: 80.3 };
  const open = async (w: number, h: number): Promise<{ page: Page; problems: string[] }> => {
    const problems: string[] = [];
    const page = {
      evaluate: async (fn: unknown) => (typeof fn === "string" ? [] : String(fn).includes("getBoundingClientRect") ? { bottom: h * (endVh[w] ?? 0) / 100, height: 10, vh: h } : undefined),
      close: async () => { problems.push("page error: late"); },
    } as unknown as Page;
    return { page, problems };
  };
  await assert.rejects(pageStylesheetDoesNotReachTheCue(open), (e: Error) => {
    assert.ok(e.message.includes("the page stylesheet reaches the text layer"));
    assert.deepEqual((e as { actual?: unknown }).actual, ["room.css loaded, 16x9: page error: late", "room.css loaded, 4x3: page error: late", "room.css loaded, 5x4: page error: late"]);
    return true;
  });
});

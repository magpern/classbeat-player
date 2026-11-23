// No run and no steady light on the plain screen (docs/design/room-2d.md, "Motion and reduced motion";
// issue #583): the room screen's own code and styles set no CSS transition or animation, move nothing from
// a frame loop, run no Web Animation, and read none of the shared motion tokens, which the scene, the
// companion, the rider and the play screen keep (`--m-change`, `--m-flash`, `--m-state`). The page checks
// (room-s6.test.ts, motion.test.ts, room-checks.test.ts C7) read the same off the running screen.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOM = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "room");
const files = readdirSync(ROOM).filter((f) => /\.(ts|css)$/.test(f));

const BANNED: readonly (readonly [RegExp, string])[] = [
  [/\brequestAnimationFrame\b|\bcancelAnimationFrame\b/, "a frame loop"],
  [/\bsetInterval\b/, "a repeating timer"],
  [/\.animate\(|\bgetAnimations\b|\bAnimation\b/, "a Web Animation"],
  [/\btransition(-[a-z]+)?\s*:(?!\s*none\b)/i, "a CSS transition"],
  [/\banimation(-[a-z]+)?\s*:(?!\s*none\b)|@keyframes/i, "a CSS animation"],
  [/\bwill-change\b/, "will-change"],
  [/--m-(change|flash|state)\b/, "a shared motion token"],
  [/\bopacity\s*:/, "opacity (a fade or a steady light)"],
];

describe("the room screen's own code and styles", () => {
  it("has the files it is checked on", () => {
    assert.ok(files.includes("mount.ts") && files.includes("room.css") && files.length > 20);
  });

  for (const f of files) {
    it(`${f} sets no transition, animation, frame loop or shared motion token`, () => {
      const text = readFileSync(join(ROOM, f), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
      for (const [pattern, what] of BANNED) assert.doesNotMatch(text, pattern, `${f} has ${what}`);
    });
  }

  it("the harness's freeze rule (transition: none) is not a transition", () => {
    assert.doesNotMatch(":root[data-freeze] * { transition: none !important; animation: none !important; }", BANNED[3][0]);
    assert.doesNotMatch(":root[data-freeze] * { transition: none !important; animation: none !important; }", BANNED[4][0]);
  });

  it("the check sees what it bans", () => {
    for (const [pattern] of BANNED) assert.ok(pattern.test("transition: opacity 1s; animation: x; @keyframes a; opacity: 0; requestAnimationFrame(f); setInterval(f); el.animate(); will-change: a; var(--m-flash); getAnimations()"), String(pattern));
  });
});

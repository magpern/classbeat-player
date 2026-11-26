// S6 (room-2d.md, "Motion and reduced motion"): the control band and the join sheet run nothing. Their style
// sheets hold no transition, no animation and no keyframes, and read none of the shared motion tokens
// (`--m-change`, `--m-flash`, `--m-state`, which other screens keep reading). Comments are not code.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";
import { type Check, forbids, lineCode, type Mutation, mutationGaps, oldView } from "./rule-sources.ts";

const RENDERER = join(REPO, "player", "app", "src", "renderer");
const read = (file: string): string => readFileSync(join(RENDERER, file), "utf8");
// Each check reads two views (rule-sources.ts, issue #861): what it read before (a style sheet with its
// block comments out, a script with every "//" to the end of its line out), and the file with only its
// real comments out, so a "/*" or "//" in a string hides nothing from it.
const blockCode = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS: readonly RegExp[] = [/transition/i, /animation/i, /@keyframes/i, /--m-(change|flash|state)/, /\bfading\b/];
const STYLE = "a style that runs";
const checks = new Map<string, Check>([
  ...CSS.map((re) => [String(re), forbids(re, blockCode)] as const),
  [STYLE, forbids(/\.animate\(|requestAnimationFrame|style\.(transition|animation)|classList\.add\(["']fad/, lineCode)],
]);

for (const file of ["room-band.css", "room-join.css"]) {
  test(`${file}: no transition, no animation, no keyframes, no motion token`, () => {
    for (const re of CSS) assert.ok(!checks.get(String(re))!(file, read(file)), `${file}: ${re}`);
  });
}

test("the band's and the sheet's scripts set no style that runs", () => {
  for (const file of ["room-band.ts", "room-join.ts", "room-marks.ts"]) assert.ok(!checks.get(STYLE)!(file, read(file)), file);
});

test('each check catches what a "/*" or "//" in a string hides from the old view (issue #861)', () => {
  const ROOT = ":root { --t-control: 3.6vh; }";
  const JOIN = ".join {";
  const BAND = "export interface BandHost {";
  // A "/*" in a `content` string: the old view takes out everything up to the "*/" of a later one.
  const css = (anchor: string, rule: string): string => `${anchor}\n.x::before { content: "/*"; ${rule} }\n.y::after { content: "*/"; }\n`;
  const hide = (after: string): string => `const s = "//"; ${after}\n${BAND}`;
  const table: readonly Mutation[] = [
    [String(CSS[0]), "room-band.css", ROOT, css(ROOT, "transition: opacity 1s;"), true],
    [String(CSS[1]), "room-join.css", JOIN, css(JOIN, "animation: run 1s;"), true],
    [String(CSS[2]), "room-band.css", ROOT, css(ROOT, "} @keyframes run { from { opacity: 0; }"), true],
    [String(CSS[3]), "room-join.css", JOIN, css(JOIN, "opacity: var(--m-flash);"), true],
    [String(CSS[4]), "room-band.css", ROOT, css(ROOT, "} .band.fading { opacity: 0;"), true],
    [STYLE, "room-band.ts", BAND, hide("requestAnimationFrame(draw);"), true],
    [STYLE, "room-band.ts", BAND, hide('el.classList.add("fade");'), true],
  ];
  const [sheets, scripts] = [table.filter(([, p]) => p.endsWith(".css")), table.filter(([, p]) => p.endsWith(".ts"))];
  assert.deepEqual([...mutationGaps(sheets, checks, read, oldView(blockCode)), ...mutationGaps(scripts, checks, read, oldView(lineCode))], []);
  assert.deepEqual([...new Set(table.map(([c]) => c))].sort(), [...checks.keys()].sort());
});

// A drift guard: every field the room screen reads (src/room/input.ts) must still exist, with the
// same type, in the player's `ClockView` and `LinkView` (player/app/src/core). Read as text, so the
// web lane needs nothing installed from player/ and imports nothing of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `name: type` of every readonly field of `export interface <name> { ... }` in a source file. */
function fields(file: string, name: string): Map<string, string> {
  const src = readFileSync(file, "utf8");
  const body = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  assert.ok(body, `${name} not found in ${file}`);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/readonly (\w+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const own = (name: string): Map<string, string> => fields(join(WEB, "src", "room", "input.ts"), name);
const player = (file: string, name: string): Map<string, string> => fields(join(WEB, "..", "player", "app", "src", "core", file), name);

function assertCovered(ours: Map<string, string>, theirs: Map<string, string>, label: string): void {
  assert.ok(ours.size > 0, label);
  for (const [k, type] of ours) {
    assert.ok(theirs.has(k), `${label}: the player has no field "${k}"`);
    // Our type may be narrower (a union we do not read), never different.
    const t = theirs.get(k) ?? "";
    assert.ok(type === t || t.includes(type) || type.includes(t.replace(/^readonly /, "")), `${label}.${k}: ours "${type}", the player's "${t}"`);
  }
}

describe("the room input follows the player's snapshot", () => {
  it("ClockInput is read from ClockView", () => {
    assertCovered(own("ClockInput"), player(join("clock", "view.ts"), "ClockView"), "ClockInput");
  });

  it("LinkInput is read from LinkView", () => {
    assertCovered(own("LinkInput"), player(join("link", "view.ts"), "LinkView"), "LinkInput");
  });

  it("the link states are the player's", () => {
    const states = readFileSync(join(WEB, "..", "player", "app", "src", "core", "link", "types.ts"), "utf8").match(/export type LinkStateName =([^;]+);/)?.[1] ?? "";
    const theirs = [...states.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    const ours = readFileSync(join(WEB, "src", "room", "input.ts"), "utf8").match(/export type LinkStateName =([^;]+);/)?.[1] ?? "";
    assert.deepEqual([...ours.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort(), theirs);
  });
});

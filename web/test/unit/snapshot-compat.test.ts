// A compile-time guard: the player's `Snapshot` (player/app/src/core/snapshot.ts) must stay
// assignable to what the room screen reads. A type-only import: nothing of the player is loaded at
// run time, and `npm run typecheck` fails here when the two drift apart.
import assert from "node:assert/strict";
import { it } from "node:test";
import type { Snapshot } from "../../../player/app/src/core/snapshot.ts";
import type { RoomInput } from "../../src/room/input.ts";

/** Compiles only while a player snapshot is a valid room input. */
export const fromPlayer = (s: Snapshot): RoomInput => s;

it("a player snapshot is a room input (checked by the type system)", () => {
  assert.equal(typeof fromPlayer, "function");
});

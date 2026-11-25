// The rail's link line for a mix class (docs/design/swedebeat.md, "Room screen"): the player sends
// the line as `mix` in the frame; the screen draws only the spec's fixed words and shapes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toRoomModel } from "../../src/room/adapter.ts";
import { clockAt, linkAt } from "../../src/fixtures/build.ts";
import { STATE_FIXTURES } from "../../src/fixtures/states.ts";
import type { MixInput, RoomInput } from "../../src/room/input.ts";
import { MIX_REASONS, MIX_SHORT_REASONS, mixPlate, mixWordsAllowed } from "../../src/room/mix-words.ts";

const running = STATE_FIXTURES.running;
const doc = running.doc as NonNullable<RoomInput["doc"]>;
const view = running.view;
if (!view) throw new Error("no view");
const ready = clockAt(doc, 0, "ready");

const rail = (i: RoomInput) => toRoomModel(i).rail.link;
const before = (mix: MixInput | null): RoomInput => ({ ...running, view: ready, link: null, mix });
const during = (mix: MixInput | null): RoomInput => ({ ...running, link: null, mix });

describe("the mix's link line", () => {
  it("draws the six states of the spec with their shapes", () => {
    assert.deepEqual(rail(before({ text: "Mix ready", shape: "dot" })), { text: "Mix ready", look: "ready" });
    assert.deepEqual(rail(before({ text: "Downloading the mix 63%", shape: "circle" })), { text: "Downloading the mix 63%", look: "work" });
    assert.deepEqual(rail(before({ text: "Press Start · Swedebeat is not connected", shape: "square" })), { text: "Press Start · Swedebeat is not connected", look: "manual" });
    assert.deepEqual(rail(during({ text: "Playing the mix", shape: "dot" })), { text: "Playing the mix", look: "ready" });
    assert.deepEqual(rail(during({ text: "Mix still downloading", shape: "news" })), { text: "Mix still downloading", look: "manual", news: true });
    assert.deepEqual(rail(during({ text: "Manual clock", shape: "square" })), { text: "Manual clock", look: "manual" });
  });

  it("allows every long and short reason and every whole percent", () => {
    for (const r of MIX_REASONS) assert.ok(mixWordsAllowed({ text: `Press Start · ${r}`, shape: "square" }), r);
    for (const r of MIX_SHORT_REASONS) assert.ok(mixWordsAllowed({ text: r, shape: "news" }), r);
    for (let p = 0; p <= 100; p++) assert.ok(mixWordsAllowed({ text: `Downloading the mix ${p}%`, shape: "circle" }), String(p));
  });

  it("draws nothing that is not a fixed pair: the rail keeps its own line", () => {
    const refused: MixInput[] = [
      { text: "Mix ready", shape: "square" },
      { text: "Playing the mix", shape: "news" },
      { text: "Downloading the mix 101%", shape: "circle" },
      { text: "Downloading the mix 07%", shape: "circle" },
      { text: "Downloading the mix -1%", shape: "circle" },
      { text: "Press Start · <img src=x>", shape: "square" },
      { text: "Press Start · Swedebeat is not connected ", shape: "square" },
      { text: "Thursday threshold.mp3", shape: "dot" },
      { text: "Mix not checked", shape: "square" },
      { text: "Mix ready", shape: "ring" as MixInput["shape"] },
      { text: 7 as unknown as string, shape: "dot" },
    ];
    for (const m of refused) assert.equal(mixPlate(m), null, JSON.stringify(m));
    assert.deepEqual(rail(before({ text: "Thursday threshold.mp3", shape: "dot" })), { text: "Press Start", look: "manual" });
  });

  it("is absent or null for any other class: the rail is as before", () => {
    assert.deepEqual(rail({ ...running, link: linkAt(view, "Locked") }), { text: "Following Spotify", look: "quiet" });
    assert.deepEqual(rail({ ...running, link: linkAt(view, "Locked"), mix: null }), { text: "Following Spotify", look: "quiet" });
  });

  it("the page's own notice still comes first", () => {
    assert.deepEqual(rail({ ...during({ text: "Playing the mix", shape: "dot" }), notice: "reloaded" }), { text: "Reloaded: back to the start", look: "manual", news: true });
  });
});

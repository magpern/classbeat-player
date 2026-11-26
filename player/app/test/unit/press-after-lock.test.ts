// A band press right after a reading changed the link, before the next frame (issue 885): the
// desktop controller routes it on the state as it is now, not as the last snapshot left it.
// Mirrors the phone's fix in #883 (clock-room.ts, catchUp before routing).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { MusicReader, MusicTransport, Observation, TransportAction } from "../../src/core/link/index.ts";
import { createController } from "../../src/main/controller.ts";
import { converterExamples } from "./fixtures.ts";

const text = readFileSync(converterExamples()[0], "utf8");
const first = JSON.parse(text).songs[0] as { title: string; artist: string; length_ms: number };

/** Follow is on and nothing has been read yet; no snapshot is taken between a reading and a press. */
function rig() {
  const sent: TransportAction[] = [];
  const self = { t: 0, obs: null as Observation | null };
  const gone = { value: false };
  const reader: MusicReader & MusicTransport = { kind: "fake", latest: () => self.obs, send: (a) => void sent.push(a), unavailable: () => gone.value };
  const c = createController(() => self.t, reader, reader);
  c.open("a.json", text);
  c.command({ type: "follow" });
  const reading = (positionMs: number, playing = true, title = first.title): void => {
    self.obs = { title, artist: first.artist, lengthMs: first.length_ms, positionMs, playing, at: self.t, seenAt: self.t };
  };
  return { c, sent, self, reading, gone };
}

for (const [type, action] of [["pause", "pause"], ["next", "next"], ["resume", "play"]] as const) {
  test(`${type} pressed right after the first lock, before the next frame, goes to the music once as "${action}"`, () => {
    const { c, sent, self, reading } = rig();
    self.t = 1000;
    reading(5000);
    const snap = c.command({ type });
    assert.deepEqual(sent, [action], "exactly one transport command for the press");
    assert.equal(snap.link?.mode, "following", "the press did not hand the clock over to manual");
    assert.equal(snap.link?.state, "Locked");
    assert.equal(snap.view?.status, "running", "the clock itself was not paused: only the music's answer does that");
  });
}

test("a press right after the music went off the list, before the next frame, stays on the clock and sends nothing", () => {
  const { c, sent, self, reading } = rig();
  self.t = 1000;
  reading(5000);
  assert.equal(c.snapshot().link?.state, "Locked");
  self.t = 1500;
  reading(1000, true, "Not in the class");
  c.command({ type: "next" });
  assert.deepEqual(sent, [], "no transport command while not following");
});

for (const press of ["band Pause", "named pause"] as const) {
  test(`${press} right after the reader said it is unavailable here, before the next frame, sends nothing`, () => {
    const { c, sent, self, reading, gone } = rig();
    self.t = 1000;
    reading(5000);
    assert.equal(c.snapshot().link?.mode, "following");
    gone.value = true;
    if (press === "band Pause") c.command({ type: "pause" });
    else c.music("pause");
    assert.deepEqual(sent, [], "no transport command once following is unavailable");
  });
}

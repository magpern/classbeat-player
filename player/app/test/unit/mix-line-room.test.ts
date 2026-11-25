// Every line the player can send (core/mix/mix-line.ts) is one the room screen draws: the web
// lane's fixed list (web/src/room/mix-words.ts) holds each of them, so no state is left blank.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FELL_BACK_SHOW_MS, mixLineOf } from "../../src/core/mix/mix-line.ts";
import type { MixLine, MixPlayState } from "../../src/core/mix/mix-line.ts";
import { REASON_WORDS, SHORT_REASON_WORDS } from "../../src/core/mix/mode-policy.ts";
import type { FallbackReason } from "../../src/core/mix/mode-policy.ts";
import { MIX_REASONS, MIX_SHORT_REASONS, mixPlate } from "../../../../web/src/room/mix-words.ts";

const REASONS = Object.keys(REASON_WORDS) as FallbackReason[];

function everyLine(): MixLine[] {
  const states: MixPlayState[] = [{ kind: "ready" }, { kind: "playing" }];
  for (let p = -5; p <= 105; p += 0.5) states.push({ kind: "downloading", percent: p });
  states.push({ kind: "downloading", percent: Number.NaN });
  for (const reason of REASONS) for (const since of [null, 0]) states.push({ kind: "manual", reason, since });
  const out: MixLine[] = [];
  for (const s of states) for (const started of [false, true]) for (const now of [1, FELL_BACK_SHOW_MS + 1]) {
    const l = mixLineOf(s, started, now);
    if (l !== null) out.push(l);
  }
  return out;
}

describe("the room draws every mix line", () => {
  it("each line the player can make is a fixed pair of the room's list", () => {
    const lines = everyLine();
    assert.ok(lines.length > 400);
    for (const l of lines) assert.notEqual(mixPlate(l), null, JSON.stringify(l));
  });

  it("the room's reason lists are the player's", () => {
    assert.deepEqual([...MIX_REASONS].sort(), Object.values(REASON_WORDS).sort());
    assert.deepEqual([...MIX_SHORT_REASONS].sort(), Object.values(SHORT_REASON_WORDS).sort());
  });
});

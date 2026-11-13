// The phone remote's passing notes on the room band (room-2d.md, "No answer" and "Ended";
// src/core/room/remote-note.ts, issue #222): a note that comes while the band is hidden shows at
// the next show and goes at the hide after that. Pure; no fakes needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bandMoved, NO_NOTE, shownSlot, slotArrived } from "../../src/core/room/remote-note.ts";
import type { NoteMemory } from "../../src/core/room/remote-note.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";

const OFF: RemoteView = { slot: "available", note: "none" };
const AWAY: RemoteView = { slot: "available", note: "unreachable" };
const ENDED: RemoteView = { slot: "available", note: "ended" };

/** The band's moves as the renderer makes them: hidden to shown and back. */
const show = (n: NoteMemory): NoteMemory => bandMoved(n, true, false);
const hide = (n: NoteMemory): NoteMemory => bandMoved(n, false, true);

for (const [label, note] of [["Can't reach site", AWAY], ["Phone remote ended", ENDED]] as const) {
  test(`${label}: a note that arrives while the band is hidden shows at the next show and goes at the following hide`, () => {
    // The band starts hidden, Off.
    let n = slotArrived(NO_NOTE, OFF);
    assert.deepEqual(shownSlot(n), OFF);
    // The note comes in while the band is hidden.
    n = slotArrived(n, note);
    // Still hidden: a later move within hidden keeps it.
    n = bandMoved(n, true, true);
    // The next show shows it.
    n = show(n);
    assert.deepEqual(shownSlot(n), note);
    // The following hide takes it away, and the show after that does not bring it back.
    n = hide(n);
    assert.deepEqual(shownSlot(n), OFF);
    n = show(n);
    assert.deepEqual(shownSlot(n), OFF);
    // The same note sent again (a refresh) is not news.
    n = slotArrived(n, note);
    assert.deepEqual(shownSlot(n), OFF);
  });
}

test("a note that arrives while the band is shown shows at once and goes at the next hide", () => {
  let n = show(slotArrived(NO_NOTE, OFF));
  n = slotArrived(n, ENDED);
  assert.deepEqual(shownSlot(n), ENDED);
  n = hide(n);
  assert.deepEqual(shownSlot(n), OFF);
});

test("a different note is news again; a slot that is not a passing note is shown as it is", () => {
  let n = hide(show(slotArrived(NO_NOTE, AWAY)));
  assert.deepEqual(shownSlot(n), OFF);
  n = slotArrived(n, ENDED);
  assert.deepEqual(shownSlot(n), ENDED);
  const on: RemoteView = { slot: "on", joinCode: "BCDF-GHJK", phones: 1, reconnecting: false };
  n = hide(slotArrived(n, on));
  assert.deepEqual(shownSlot(n), on);
  assert.deepEqual(shownSlot(hide(slotArrived(n, { slot: "starting" }))), { slot: "starting" });
});

test("a note repeated before the band shows is not lost: the first one shows at the next show and goes at the next hide (#224 N1)", () => {
  // The band starts hidden, Off; the note arrives, then the same note again, still hidden.
  let n = slotArrived(NO_NOTE, OFF);
  n = slotArrived(n, AWAY);
  n = slotArrived(n, AWAY);
  n = show(n);
  assert.deepEqual(shownSlot(n), AWAY);
  n = hide(n);
  assert.deepEqual(shownSlot(n), OFF);
  n = show(n);
  assert.deepEqual(shownSlot(n), OFF);
});

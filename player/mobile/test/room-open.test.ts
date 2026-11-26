// The room screen opens the class picked on the class list (issue #871): asked of a fake native side
// through getClass, read by the shared core, and shown before Start; any other answer goes back to
// the list's plate, and no room, fixture or room screen is made.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INVALID_MESSAGE, NEWER_VERSION_MESSAGE, readClassText } from "../../app/src/core/class-file.ts";
import { classIdOf, roomFor } from "../src/room/address.ts";
import { readClassAnswer } from "../src/room/class-answer.ts";
import { openRoom } from "../src/room/open-room.ts";
import { listAfter, PLATE_WORDS, plateFor } from "../src/room/plate-words.ts";
import { classDoc, harness, ID } from "./room-fakes.ts";

const FORMAT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schema", "class-format", "v1");

test("opening a class from the list shows that class's first interval before Start", async () => {
  const doc = classDoc();
  const h = harness(() => Promise.resolve({ document: doc }), new URL(roomFor(ID), "https://localhost/").search);
  assert.equal(await openRoom(h.deps), "open");
  assert.deepEqual(h.asked, [{ id: ID }]);
  assert.deepEqual(h.went, []);
  assert.equal(h.installed.length, 1);
  // The room is in place before the room screen's module first runs.
  assert.equal(h.mounted, 1);
  assert.equal(h.roomAtMount[0], h.installed[0]);
  const frame = await h.installed[0].state();
  assert.equal(frame.doc?.class.title, (doc.class as { title: string }).title);
  assert.equal(frame.view?.status, "ready");
  assert.equal(frame.view?.intervalIndex, 0);
  assert.equal(frame.view?.classMs, 0);
  // Only the manual clock: Follow is not offered and every band key goes to the clock.
  assert.equal(frame.link?.available, false);
  assert.deepEqual(new Set(Object.values(frame.band ?? {})), new Set(["clock"]));
});

const NOT_FOUND = { error: "not_found" };

test("a missing class goes back to the list's plate and makes no room", async () => {
  const cases: [string, string, () => Promise<unknown>][] = [
    ["not found", `?id=${ID}`, () => Promise.resolve(NOT_FOUND)],
    ["refused (null)", `?id=${ID}`, () => Promise.resolve(null)],
    ["refused (rejected)", `?id=${ID}`, () => Promise.reject(new Error("refused"))],
    ["another shape", `?id=${ID}`, () => Promise.resolve({ document: classDoc(), token: "x" })],
    ["a list", `?id=${ID}`, () => Promise.resolve([classDoc()])],
    ["no id", "", () => Promise.resolve({ document: classDoc() })],
    ["not a class id", "?id=1", () => Promise.resolve({ document: classDoc() })],
    ["upper-case id", `?id=${ID.toUpperCase()}`, () => Promise.resolve({ document: classDoc() })],
    ["more than the id", `?id=${ID}&x=1`, () => Promise.resolve({ document: classDoc() })],
  ];
  for (const [name, search, answer] of cases) {
    const h = harness(answer, search);
    assert.equal(await openRoom(h.deps), "missing", name);
    assert.deepEqual(h.went, [listAfter("missing")], name);
    assert.deepEqual([h.installed.length, h.mounted], [0, 0], name);
  }
  // An id the page will not pass is never asked for.
  const h = harness(() => Promise.resolve({ document: classDoc() }), "?id=../x");
  await openRoom(h.deps);
  assert.deepEqual(h.asked, []);
});

test("an unreadable class or one of an unknown format goes back to its plate and makes no room", async () => {
  const bad = { ...classDoc(), intervals: "none" };
  const newer = { ...classDoc(), format_version: "2.0" };
  const cases: [unknown, string][] = [
    [{ document: bad }, "invalid"],
    [{ document: "{}" }, "invalid"],
    [{ document: [] }, "invalid"],
    [{ document: newer }, "newer"],
  ];
  for (const [answer, why] of cases) {
    const h = harness(() => Promise.resolve(answer));
    assert.equal(await openRoom(h.deps), why, JSON.stringify(answer).slice(0, 40));
    assert.deepEqual(h.went, [listAfter(why as "invalid")]);
    assert.deepEqual([h.installed.length, h.mounted], [0, 0]);
  }
  assert.deepEqual(readClassAnswer(NOT_FOUND), { ok: false, why: "missing" });
});

test("the phone reads every example of the format as the desktop reads its file", () => {
  const schema = JSON.parse(readFileSync(join(FORMAT, "class.schema.json"), "utf8"));
  let seen = 0;
  for (const dir of ["valid", "invalid", "reader"]) {
    for (const name of readdirSync(join(FORMAT, "examples", dir)).filter((n) => n.endsWith(".json"))) {
      const text = readFileSync(join(FORMAT, "examples", dir, name), "utf8");
      let doc: unknown;
      try {
        doc = JSON.parse(text);
      } catch {
        continue; // not JSON: native code never answers it as a document
      }
      const desktop = readClassText(text, schema);
      const want = desktop.ok ? "ok" : desktop.message === NEWER_VERSION_MESSAGE ? "newer" : "invalid";
      const phone = readClassAnswer({ document: doc });
      const isObject = doc !== null && typeof doc === "object" && !Array.isArray(doc);
      assert.equal(phone.ok ? "ok" : phone.why, isObject ? want : "invalid", `${dir}/${name}`);
      seen += 1;
    }
  }
  assert.ok(seen > 30, `only ${seen} examples`);
});

test("the plate's words are fixed, the reader's own, and chosen only by an exact name", () => {
  assert.equal(PLATE_WORDS.invalid.detail, INVALID_MESSAGE);
  assert.equal(PLATE_WORDS.newer.detail, NEWER_VERSION_MESSAGE);
  assert.equal(PLATE_WORDS.missing.head, "That class is not here");
  for (const why of ["missing", "invalid", "newer"] as const) {
    assert.ok(listAfter(why).startsWith("instructor.html#"));
    assert.equal(plateFor(new URL(listAfter(why), "https://localhost/").hash), PLATE_WORDS[why]);
  }
  for (const h of ["", "#", "#class-", "#class-MISSING", "#class-missing ", "#class-toString", "#class-__proto__", "#missing", "#class-missing&x"]) {
    assert.equal(plateFor(h), null, h);
  }
});

test("the list opens the room screen with the class id, and only that address yields it", () => {
  assert.equal(roomFor(ID), `room.html?id=${ID}`);
  assert.equal(classIdOf(`?id=${ID}`), ID);
  for (const s of ["", "?", "?id=", `?id=${ID}x`, `?x=1&id=${ID}`, `?id=${ID}&id=${ID}`, `?ID=${ID}`, `?id=%30${ID.slice(1)}`]) assert.equal(classIdOf(s), null, s);
});

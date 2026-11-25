// The `cbp-mix:` URL shape and the byte ranges a play request may ask for (core/mix/scheme-policy.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { byteRange, playIdOf, playUrl, PLAY_ID } from "../../src/core/mix/scheme-policy.ts";

const ID = "0123456789abcdef0123456789abcdef";

test("a play URL names the play id and nothing else", () => {
  assert.equal(playUrl(ID), `cbp-mix://play/${ID}`);
  assert.equal(playIdOf(playUrl(ID)), ID);
  assert.match(ID, PLAY_ID);
});

test("playUrl refuses anything but 32 lower-case hex digits", () => {
  for (const bad of ["", ID.toUpperCase(), ID.slice(1), `${ID}0`, "../etc/passwd", `${ID.slice(0, 31)}g`]) assert.throws(() => playUrl(bad), RangeError, bad);
});

test("playIdOf takes exactly the play shape: no query, fragment, port, other host, path or scheme", () => {
  for (const bad of [
    `cbp-mix://play/${ID}?x=1`,
    `cbp-mix://play/${ID}#a`,
    `cbp-mix://play:80/${ID}`,
    `cbp-mix://other/${ID}`,
    `cbp-mix://play/${ID}/x`,
    `cbp-mix://play/x/${ID}`,
    `file://play/${ID}`,
    `https://play/${ID}`,
    `CBP-MIX://play/${ID}`,
    `cbp-mix://play/${ID.toUpperCase()}`,
    ` cbp-mix://play/${ID}`,
    `cbp-mix://play/${ID}\n`,
  ]) {
    assert.equal(playIdOf(bad), null, JSON.stringify(bad));
  }
  for (const bad of [null, undefined, 1, {}, [`cbp-mix://play/${ID}`]]) assert.equal(playIdOf(bad), null);
});

test("byteRange: the whole file without a header, one range clipped to the file", () => {
  assert.deepEqual(byteRange(null, 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-500", 100), { start: 0, end: 99 });
});

test("byteRange: unsatisfiable past the end, for several ranges, reversed ones and any other form", () => {
  for (const bad of ["bytes=100-", "bytes=200-300", "bytes=0-1,5-6", "bytes=-", "bytes=5-2", "items=0-1", "bytes=a-b", "bytes=-0", "bytes=1234567890123456-"]) {
    assert.equal(byteRange(bad, 100), "unsatisfiable", bad);
  }
  assert.equal(byteRange(null, 0), "unsatisfiable");
});

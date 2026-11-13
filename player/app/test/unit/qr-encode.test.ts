// The pure QR encoder (src/core/qr/): bit for bit equal to a reference encoder's output for fixed
// masks (test/unit/qr-vectors.ts), read back by an independent reader (test/unit/qr-decode.ts),
// the smallest version that fits, the lowest-penalty mask, and its limits.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { dataCodewords, encodeQr } from "../../src/core/qr/qr-encode.ts";
import { penalty } from "../../src/core/qr/qr-penalty.ts";
import { decodeQr } from "./qr-decode.ts";
import { PANEL_URL, VECTORS } from "./qr-vectors.ts";

const text = (rows: readonly (readonly boolean[])[]): string[] => rows.map((r) => r.map((d) => (d ? "1" : "0")).join(""));
const sha = (rows: readonly string[]): string => createHash("sha256").update(rows.join("\n")).digest("hex");

test("equal, module for module, to the reference encoder's known vectors", () => {
  assert.ok(VECTORS.length >= 12);
  for (const v of VECTORS) {
    const qr = encodeQr(v.text, { mask: v.mask });
    const label = `${v.text.slice(0, 20)} v${v.version} mask ${v.mask}`;
    assert.equal(qr.version, v.version, label);
    assert.equal(qr.mask, v.mask, label);
    if (v.rows) assert.deepEqual(text(qr.rows), v.rows, label);
    if (v.sha256) assert.equal(sha(text(qr.rows)), v.sha256, label);
  }
  // All eight masks of the panel's link are covered.
  assert.deepEqual([...new Set(VECTORS.filter((v) => v.text === PANEL_URL).map((v) => v.mask))].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("the independent reader reads back exactly what was encoded, every mask and many lengths", () => {
  const samples = [
    PANEL_URL,
    "https://classbeat.example/control#ZZZZ-ZZZZ.BBBB-BBBB",
    "http://127.0.0.1:8080/control#BCDF-GHJK.QRST-VWXZ",
    "a",
    "é ü ✓",
    ...[13, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 152, 180, 213, 251, 287, 331].map((n) => "z".repeat(n)),
  ];
  for (const s of samples) {
    for (const mask of [undefined, 0, 1, 2, 3, 4, 5, 6, 7]) {
      const qr = encodeQr(s, mask === undefined ? {} : { mask });
      const d = decodeQr(qr.rows);
      assert.equal(d.text, s, `${s.slice(0, 20)} mask ${mask}`);
      assert.equal(d.version, qr.version);
      assert.equal(d.mask, qr.mask);
    }
  }
});

test("the reader is not a rubber stamp: one flipped data module and the syndromes catch it", () => {
  const qr = encodeQr(PANEL_URL);
  const rows = qr.rows.map((r) => [...r]);
  rows[qr.size - 1][qr.size - 1] = !rows[qr.size - 1][qr.size - 1];
  assert.throws(() => decodeQr(rows), /syndrome|pad|terminator|mode/);
  const fmt = qr.rows.map((r) => [...r]);
  fmt[8][0] = !fmt[8][0];
  assert.throws(() => decodeQr(fmt), /format/);
});

test("the smallest version that fits, error correction M", () => {
  // Byte-mode capacity at M (ISO/IEC 18004 Table 7): 14, 26, 42 and 62 bytes for versions 1 to 4.
  for (const [v, cap] of [[1, 14], [2, 26], [3, 42], [4, 62]] as const) {
    assert.equal(dataCodewords(v) - 2, cap, `capacity of version ${v}`);
    assert.equal(encodeQr("q".repeat(cap)).version, v);
    assert.equal(encodeQr("q".repeat(cap + 1)).version, v + 1);
  }
  assert.equal(encodeQr(PANEL_URL).version, 4);
});

test("the mask kept is the one with the lowest penalty", () => {
  for (const s of [PANEL_URL, "a", "z".repeat(150)]) {
    const chosen = encodeQr(s);
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penalty(encodeQr(s, { mask }).rows.map((r) => [...r])));
    assert.equal(scores[chosen.mask], Math.min(...scores), s.slice(0, 20));
    assert.equal(scores.indexOf(Math.min(...scores)), chosen.mask, "the first of equal scores");
  }
});

test("too long for version 40, or a mask that is not 0 to 7, is refused", () => {
  assert.equal(encodeQr("w".repeat(2331)).version, 40);
  assert.throws(() => encodeQr("w".repeat(2332)), RangeError);
  for (const mask of [-1, 8, 1.5, Number.NaN]) assert.throws(() => encodeQr("a", { mask }), RangeError);
});

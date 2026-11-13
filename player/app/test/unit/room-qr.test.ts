// The class code's QR code (core/room/qr.ts, qr-ecc.ts): version 3, byte mode, level M where it
// fits. The golden matrix was checked by decoding it with an independent reader (jsQR) to the same
// address; the structure checks hold for any text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBits, rsDivisor, rsRemainder } from "../../src/core/room/qr-ecc.ts";
import { penalty, QR_SIZE, qrCode } from "../../src/core/room/qr.ts";

const ADDRESS = "https://classbeat.app/control#BCDF-GHJK";
const GOLDEN = [
  "#######....###.##.###.#######",
  "#.....#..#.....####.#.#.....#",
  "#.###.#.#.#.#...#..##.#.###.#",
  "#.###.#.#...#.##.#.#..#.###.#",
  "#.###.#.#....#.#####..#.###.#",
  "#.....#.##.#.#.###....#.....#",
  "#######.#.#.#.#.#.#.#.#######",
  "........##.##..##............",
  "#.#####..####.#..#..#.#####..",
  ".##......#.#.#...####.###...#",
  "...##.#####..#.#.#...#.#.....",
  "#..#.#.#.#....#.#.#...#.##.#.",
  "#...#.#######..#.#..#..#.##..",
  ".##..#....####.##..######...#",
  "#...#.#..#.#.###....##.####..",
  ".##.....#.#..#.##.#..##.#..#.",
  ".#.##.##...##.##.#.......##..",
  "#.##....#......##..######.#.#",
  "#.##.##........####.....#.#..",
  "#.##.#.##.#.#.#...###..#...#.",
  "#.#...#.#..#...#.#.######.###",
  "........#.##.######.#...#####",
  "#######...#..###.#.##.#.###..",
  "#.....#.####.#......#...#...#",
  "#.###.#.#..##.##.#..#####.#..",
  "#.###.#.##.#.#.####......####",
  "#.###.#.#.#..####..#.#######.",
  "#.....#..#....#...####.#.#.#.",
  "#######.##.#.###.###....#.#..",
];
const rows = (m: readonly (readonly boolean[])[]): string[] => m.map((r) => r.map((b) => (b ? "#" : ".")).join(""));

test("Reed-Solomon matches the standard's worked example", () => {
  // ISO/IEC 18004 annex I: "01234567" at 1-M.
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  assert.deepEqual(rsRemainder(data, rsDivisor(10)), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test("the format bits are the standard's table", () => {
  assert.equal(formatBits("M", 0), 0b101010000010010);
  assert.equal(formatBits("M", 2), 0b101111001111100);
  assert.equal(formatBits("L", 0), 0b111011111000100);
  assert.equal(formatBits("L", 7), 0b110100101110110);
});

test("the class code's address gives the golden matrix, at level M, with the lowest-penalty mask", () => {
  const q = qrCode(ADDRESS);
  assert.ok(q);
  assert.equal(q.level, "M");
  assert.equal(q.mask, 2);
  assert.deepEqual(rows(q.modules), GOLDEN);
  for (let m = 0; m < 8; m++) assert.ok(penalty(qrCode(ADDRESS, m)!.modules) >= penalty(q.modules), `mask ${m}`);
});

test("finders, timing, the dark module and both copies of the format bits are in place", () => {
  for (const text of [ADDRESS, "https://a.example/control#XXXX-XXXX", "x".repeat(53)]) {
    const q = qrCode(text)!;
    const m = q.modules;
    assert.equal(m.length, QR_SIZE);
    const finder = (x0: number, y0: number): void => {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[y0 + y]![x0 + x], ring !== 2, `${text} finder ${x0},${y0}`);
      }
    };
    finder(0, 0);
    finder(QR_SIZE - 7, 0);
    finder(0, QR_SIZE - 7);
    for (let i = 8; i < QR_SIZE - 8; i++) {
      assert.equal(m[6]![i], i % 2 === 0, `timing row ${i}`);
      assert.equal(m[i]![6], i % 2 === 0, `timing column ${i}`);
    }
    assert.equal(m[QR_SIZE - 8]![8], true, "dark module");
    const f = formatBits(q.level, q.mask);
    const bit = (i: number): boolean => ((f >>> i) & 1) === 1;
    // First copy, around the top-left finder.
    const around = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    around.forEach(([x, y], i) => assert.equal(m[y!]![x!], bit(i), `format ${i}`));
  }
});

test("text that does not fit, or is not plain ASCII, gives no code", () => {
  assert.ok(qrCode("x".repeat(53)));
  assert.equal(qrCode("x".repeat(54)), null);
  assert.equal(qrCode("https://exämple.org/control#BCDF-GHJK"), null);
});

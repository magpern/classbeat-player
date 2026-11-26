// Which platforms have a music reader (reader-platform.ts, ADR 0016 section 5).
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMusicReader } from "../src/room/reader-platform.ts";

test("only iOS has no music reader; every other platform behaves as before", () => {
  const table: [string, boolean][] = [
    ["ios", false],
    ["android", true],
    ["web", true],
    ["", true],
    ["iOS", true],
    ["electron", true],
  ];
  for (const [platform, reader] of table) assert.equal(hasMusicReader(platform), reader, platform);
});

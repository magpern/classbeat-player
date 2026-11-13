// The presenter window's minimum size is the spec's 1000x720 content area, the default is unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PRESENTER_SIZE } from "../../src/main/window-size.ts";

test("the minimum is 1000x720 of the content area", () => {
  assert.equal(PRESENTER_SIZE.minWidth, 1000);
  assert.equal(PRESENTER_SIZE.minHeight, 720);
  assert.equal(PRESENTER_SIZE.useContentSize, true);
});

test("the default size is unchanged and not below the minimum", () => {
  assert.equal(PRESENTER_SIZE.width, 1000);
  assert.equal(PRESENTER_SIZE.height, 760);
  assert.ok(PRESENTER_SIZE.width >= PRESENTER_SIZE.minWidth && PRESENTER_SIZE.height >= PRESENTER_SIZE.minHeight);
});

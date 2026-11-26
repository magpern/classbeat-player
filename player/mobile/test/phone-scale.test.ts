// The room screen's options on the phone (issue #871): /play's scale held upright, none on its side.
import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneRoomOptions } from "../src/room/phone-scale.ts";
import { scaleFor } from "../../../web/src/room/score-scale.ts";

test("upright the room screen gets /play's scale; on its side it gets none, as the desktop passes", () => {
  const view = { innerWidth: 390, innerHeight: 844 };
  const opts = phoneRoomOptions(undefined, view);
  const scale = (): unknown => opts.scale;
  assert.deepEqual(opts.scale?.(), scaleFor(390, 844));
  view.innerWidth = 844;
  view.innerHeight = 390;
  assert.equal(scale(), undefined);
  view.innerWidth = 360;
  view.innerHeight = 640;
  assert.deepEqual(opts.scale?.(), scaleFor(360, 640));
});

test("the page's other options are kept", () => {
  const onEnd = (): void => {};
  const opts = phoneRoomOptions({ onEnd } as never, { innerWidth: 844, innerHeight: 390 });
  assert.equal((opts as { onEnd?: unknown }).onEnd, onEnd);
});

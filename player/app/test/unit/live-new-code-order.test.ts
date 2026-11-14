// New code's order (#371 review N6, pinned by #381): the shown control code is cleared before
// `new_join_code` is sent, so at no moment does the presenter show a control code for a join code
// the server is already replacing. It fails safe and stays as it is; this test holds it. Through
// the live client over the fake live process, read at the moment the message is sent. Fakes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTROL_CODE, started } from "./live-relay.ts";

test("the control code is gone from the presenter's view and the model before new_join_code is sent", async () => {
  const r = await started();
  r.live.makeCode();
  r.socket().server({ v: 1, type: "control_code", code: CONTROL_CODE, expiresInMs: 120_000 });
  assert.equal(r.live.view().controlCode, CONTROL_CODE);
  const seen: (string | null)[] = [];
  r.socket().onSent = (m) => {
    if ((m as { type?: string }).type === "new_join_code") seen.push(r.live.view().controlCode);
  };
  r.live.newJoinCode();
  await r.advance(1000);
  assert.deepEqual(seen, [null], "new_join_code sent once, with no control code shown at that moment");
  assert.equal(r.live.view().controlCode, null);
});

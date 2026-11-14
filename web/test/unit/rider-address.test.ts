// The rider page's address rule (src/rider/core/address.ts; ADR 0007, section 5): the address keeps
// at most `/j#<join>`. A control code, a query string or any other fragment never stays (rule 14).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bareJoinCode, riderAddress } from "../../src/rider/core/address.ts";
import { CTRL, FRAGMENTS } from "../lib/rider-fragments.ts";

describe("the rider page's address", () => {
  it("keeps at most the bare join code, for every fragment in the table", () => {
    for (const [hash, join, target] of FRAGMENTS) {
      assert.equal(bareJoinCode(hash), join, hash);
      assert.deepEqual(riderAddress("/j", hash), { join, target }, hash);
      assert.match(target, /^\/j(#[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4})?$/, hash);
      if (hash.includes(`.${CTRL}`) || hash.includes(`%2E${CTRL}`)) assert.ok(!target.includes(CTRL), hash);
    }
  });

  it("keeps the page's own path and never a query string", () => {
    assert.deepEqual(riderAddress("/j/", "#KXPD-RMTB"), { join: "KXPD-RMTB", target: "/j/#KXPD-RMTB" });
    assert.deepEqual(riderAddress("/j", ""), { join: null, target: "/j" });
  });
});

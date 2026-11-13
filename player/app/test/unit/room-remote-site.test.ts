// The QR code's site (core/room/remote.ts): a plain HTTPS origin, kept only when it is exactly one,
// so the address can carry the join code in its fragment and nothing else (ADR 0005 section 2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { controlAddress, remoteViewOf, siteOf } from "../../src/core/room/remote.ts";
import type { RemoteView } from "../../src/core/room/remote.ts";

test("only a plain https origin is a site", () => {
  assert.equal(siteOf("https://classbeat.app"), "https://classbeat.app");
  assert.equal(siteOf("https://classbeat.example:8443"), "https://classbeat.example:8443");
  for (const bad of [
    "http://classbeat.app",
    "https://classbeat.app/",
    "https://classbeat.app/control",
    "https://classbeat.app?x=1",
    "https://classbeat.app#QQQQ-QQQQ",
    "https://user:pw@classbeat.app",
    "https://user@classbeat.app",
    "HTTPS://CLASSBEAT.APP",
    "javascript:alert(1)",
    "file:///etc",
    "classbeat.app",
    "",
    `https://${"a".repeat(100)}.app`,
    42,
    null,
    { toString: () => "https://classbeat.app" },
  ]) {
    assert.equal(siteOf(bad), null, String(bad));
  }
});

test("the address is the site, /control and the join code in the fragment", () => {
  assert.equal(controlAddress("https://classbeat.app", "KXPD-RMTB"), "https://classbeat.app/control#KXPD-RMTB");
});

test("the room window gets the site only when it is valid", () => {
  const on = (site: unknown): RemoteView => ({ slot: "on", joinCode: "KXPD-RMTB", phones: 1, reconnecting: false, site } as RemoteView);
  assert.deepEqual(remoteViewOf(on("https://classbeat.app")), on("https://classbeat.app"));
  const dropped = { slot: "on", joinCode: "KXPD-RMTB", phones: 1, reconnecting: false };
  for (const bad of ["https://classbeat.app/control#QQQQ-QQQQ", "https://x.app?c=QQQQ-QQQQ", 7]) assert.deepEqual(remoteViewOf(on(bad)), dropped, String(bad));
  assert.deepEqual(remoteViewOf({ slot: "on", joinCode: "KXPD-RMTB", phones: 1, reconnecting: false }), dropped);
});

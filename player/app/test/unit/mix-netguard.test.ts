// The unit tests' network guard (ADR 0013 section 2, issue 3): each guard is shown to fail on a
// synthetic violation. The guard is installed by the --import in package.json, so these tests also
// prove that every test file runs under it.
import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import { describe, it } from "node:test";
import { isLoopbackHost, NetGuardError } from "./netguard.ts";

// RFC 5737 / RFC 2606 names: nothing real, and nothing is sent because the guard throws first.
const NON_LOOPBACK_IP = "192.0.2.1";
const NON_LOOPBACK_NAME = "player-test.invalid";

describe("netguard", () => {
  it("classifies hosts", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "", undefined]) assert.equal(isLoopbackHost(h), true, String(h));
    for (const h of [NON_LOOPBACK_IP, NON_LOOPBACK_NAME, "10.0.0.1", "0.0.0.0", "localhost.invalid", "127.0.0.1.invalid"]) assert.equal(isLoopbackHost(h), false, h);
  });

  it("throws on a non-loopback connect before anything is sent", () => {
    assert.throws(() => net.connect(80, NON_LOOPBACK_IP), NetGuardError);
    assert.throws(() => net.connect({ host: NON_LOOPBACK_NAME, port: 80 }), NetGuardError);
    assert.throws(() => new net.Socket().connect(80, NON_LOOPBACK_IP), NetGuardError);
  });

  it("throws on a name lookup other than localhost", async () => {
    assert.throws(() => dns.lookup(NON_LOOPBACK_NAME, () => {}), NetGuardError);
    assert.throws(() => dns.resolve4(NON_LOOPBACK_NAME, () => {}), NetGuardError);
    assert.throws(() => dns.promises.lookup(NON_LOOPBACK_NAME), NetGuardError);
  });

  it("makes fetch to a non-loopback address fail", async () => {
    await assert.rejects(fetch(`http://${NON_LOOPBACK_IP}/`));
    await assert.rejects(fetch(`http://${NON_LOOPBACK_NAME}/`));
  });

  it("still allows loopback", async () => {
    const server = net.createServer((s) => s.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as net.AddressInfo;
    const got = await new Promise<string>((resolve, reject) => {
      const c = net.connect(port, "127.0.0.1");
      let data = "";
      c.on("data", (d) => (data += d)).on("end", () => resolve(data)).on("error", reject);
    });
    server.close();
    assert.equal(got, "ok");
    await dns.promises.lookup("localhost");
  });
});

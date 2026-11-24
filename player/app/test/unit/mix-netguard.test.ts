// The unit tests' network guard (ADR 0013 section 2, issue 3): each guard is shown to fail on a
// synthetic violation. The guard is installed by the --import in package.json, so these tests also
// prove that every test file runs under it.
import assert from "node:assert/strict";
import dgram from "node:dgram";
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
    // A numeric string is a port to Node, not a socket path.
    assert.throws(() => new net.Socket().connect("80" as unknown as number, NON_LOOPBACK_IP), NetGuardError);
  });

  it("throws on a name lookup other than localhost", async () => {
    assert.throws(() => dns.lookup(NON_LOOPBACK_NAME, () => {}), NetGuardError);
    assert.throws(() => dns.resolve4(NON_LOOPBACK_NAME, () => {}), NetGuardError);
    assert.throws(() => dns.promises.lookup(NON_LOOPBACK_NAME), NetGuardError);
  });

  it("refuses every resolver method, on the module, the promises API and both Resolver classes", async () => {
    const methods = Object.getOwnPropertyNames(dns).filter((n) => /^resolve|^reverse$|^lookupService$/.test(n) && typeof (dns as unknown as Record<string, unknown>)[n] === "function");
    for (const m of ["resolveCaa", "resolveNaptr", "resolvePtr", "resolveSoa", "resolve4", "reverse", "lookupService"]) assert.ok(methods.includes(m), m);
    const call = (o: object, m: string): unknown => (o as Record<string, (...a: unknown[]) => unknown>)[m]!(NON_LOOPBACK_NAME, 80, () => {});
    for (const m of methods) {
      assert.throws(() => call(dns, m), NetGuardError, `dns.${m}`);
      if (m in dns.Resolver.prototype) assert.throws(() => call(new dns.Resolver(), m), NetGuardError, `Resolver ${m}`);
    }
    for (const m of Object.getOwnPropertyNames(dns.promises).filter((n) => /^resolve|^reverse$|^lookupService$/.test(n))) {
      assert.throws(() => call(dns.promises, m), NetGuardError, `dns.promises.${m}`);
      if (m in dns.promises.Resolver.prototype) assert.throws(() => call(new dns.promises.Resolver(), m), NetGuardError, `promises Resolver ${m}`);
    }
    assert.throws(() => dns.lookupService(NON_LOOPBACK_IP, 80, () => {}), NetGuardError);
    assert.throws(() => dns.promises.lookupService(NON_LOOPBACK_IP, 80), NetGuardError);
    assert.throws(() => new dns.promises.Resolver().resolve4(NON_LOOPBACK_NAME), NetGuardError);
  });

  it("keeps the resolver's local settings usable", () => {
    const r = new dns.Resolver();
    r.setServers(["127.0.0.1"]);
    assert.ok(Array.isArray(r.getServers()));
  });

  it("makes fetch to a non-loopback address fail because of the guard", async () => {
    for (const url of [`http://${NON_LOOPBACK_IP}/`, `http://${NON_LOOPBACK_NAME}/`]) {
      await assert.rejects(fetch(url), (e: unknown) => (e as { cause?: unknown }).cause instanceof NetGuardError, url);
    }
  });

  it("refuses a UDP send to a non-loopback address (checked directly, not through the lookup)", () => {
    for (const host of [NON_LOOPBACK_IP, NON_LOOPBACK_NAME]) {
      const sock = dgram.createSocket("udp4"); // one socket per send: a second send would queue behind the first's bind
      try {
        assert.throws(() => sock.send("x", 9, host), NetGuardError, host);
        assert.throws(() => sock.send(Buffer.from("x"), 0, 1, 9, host), NetGuardError, host);
        assert.throws(() => sock.connect(9, host), NetGuardError, host);
      } finally {
        sock.close();
      }
    }
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

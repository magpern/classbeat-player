// The player's network guard for unit tests (ADR 0013 section 2), on the model of classbeat's
// backend/tests/netguard.py: every non-loopback connect and every name lookup other than
// `localhost` throws before anything is sent. No test is exempt and there is no switch to turn it
// off. Installed for every unit test by netguard-preload.ts (`npm run test:unit` passes it with
// --import). Unix-socket and pipe paths are not network and pass.
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";

export class NetGuardError extends Error {
  constructor(what: string) {
    super(`netguard: ${what} is blocked in tests (only loopback is reachable)`);
    this.name = "NetGuardError";
  }
}

/** True for `localhost`, `::1`, `[::1]` and 127.x.x.x. */
export function isLoopbackHost(host: string | undefined | null): boolean {
  if (host === undefined || host === null || host === "") return true; // Node's own default is localhost
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || h === "::ffff:127.0.0.1" || /^127(\.\d{1,3}){3}$/.test(h);
}

let installed = false;

/** Node's own test for "this string is a pipe or socket path, not a port" (net.isPipeName). */
const isPipeName = (v: unknown): boolean => typeof v === "string" && !(+v >= 0);

/** The dns exports that touch no network: everything else that is a function is refused. */
const DNS_LOCAL = new Set(["lookup", "getServers", "setServers", "setLocalAddress", "cancel", "getDefaultResultOrder", "setDefaultResultOrder", "Resolver", "promises", "constructor"]);

function refuseResolvers(target: object): void {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (DNS_LOCAL.has(name)) continue;
    const d = Object.getOwnPropertyDescriptor(target, name);
    if (d === undefined || typeof d.value !== "function" || !d.configurable) continue;
    Object.defineProperty(target, name, {
      ...d,
      value: () => {
        throw new NetGuardError("a name lookup");
      },
    });
  }
}

export function installNetGuard(): void {
  if (installed) return;
  installed = true;

  const realConnect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    // net.connect hands the already-normalised arguments over as an array.
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const rest = Array.isArray(args[0]) ? [] : args;
    if (first !== null && typeof first === "object") {
      const o = first as { host?: string; path?: string };
      if (o.path === undefined && !isLoopbackHost(o.host)) throw new NetGuardError("connect");
    } else if (!isPipeName(first)) {
      // connect(port, host): a number or numeric string port; no host means localhost.
      const host = rest[1];
      if (typeof host === "string" && !isLoopbackHost(host)) throw new NetGuardError("connect");
    }
    return realConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;

  // UDP: Node 22 sends through dns.lookup, newer Node skips the lookup for an address literal, so the
  // destination is checked here and the guard does not depend on that detail.
  const realSend = dgram.Socket.prototype.send as (...a: unknown[]) => void;
  dgram.Socket.prototype.send = function (this: dgram.Socket, ...args: unknown[]): void {
    // send(msg, port[, address][, cb]) or send(msg, offset, length, port[, address][, cb])
    const address = typeof args[1] === "number" && typeof args[2] === "number" ? args[4] : args[2];
    if (typeof address === "string" && !isLoopbackHost(address)) throw new NetGuardError("a UDP send");
    return realSend.apply(this, args);
  } as typeof dgram.Socket.prototype.send;
  const realDgramConnect = dgram.Socket.prototype.connect as (...a: unknown[]) => void;
  dgram.Socket.prototype.connect = function (this: dgram.Socket, ...args: unknown[]): void {
    if (typeof args[1] === "string" && !isLoopbackHost(args[1])) throw new NetGuardError("a UDP connect");
    return realDgramConnect.apply(this, args);
  } as typeof dgram.Socket.prototype.connect;

  const refuseLookup = (host: unknown): void => {
    if (typeof host !== "string" || !isLoopbackHost(host)) throw new NetGuardError("a name lookup");
  };
  const realLookup = dns.lookup as (...a: unknown[]) => unknown;
  (dns as { lookup: unknown }).lookup = (host: unknown, ...rest: unknown[]) => {
    refuseLookup(host);
    return realLookup(host, ...rest);
  };
  const realPromisesLookup = dns.promises.lookup as (...a: unknown[]) => Promise<unknown>;
  (dns.promises as { lookup: unknown }).lookup = (host: unknown, ...rest: unknown[]) => {
    refuseLookup(host);
    return realPromisesLookup(host, ...rest);
  };
  // Every other resolver call (resolve*, reverse, lookupService, and any a later Node adds) goes to a
  // name server, not the loopback: refused on the module, the promises API and both Resolver classes.
  // Instances made later read these prototypes, so they are covered too.
  for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) refuseResolvers(target);
}

// The player's network guard for unit tests (ADR 0013 section 2), on the model of classbeat's
// backend/tests/netguard.py: every non-loopback connect and every name lookup other than
// `localhost` throws before anything is sent. No test is exempt and there is no switch to turn it
// off. Installed for every unit test by netguard-preload.ts (`npm run test:unit` passes it with
// --import). Unix-socket and pipe paths are not network and pass.
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
    } else if (typeof first === "string") {
      // connect(path) is a socket path; connect(port, host) has a number first.
    } else if (typeof first === "number") {
      const host = rest[1];
      if (typeof host === "string" && !isLoopbackHost(host)) throw new NetGuardError("connect");
    }
    return realConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;

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
  // Resolver calls go to a name server, not the loopback: all refused.
  for (const name of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNs", "resolveSrv", "resolveTxt", "reverse"] as const) {
    (dns as unknown as Record<string, unknown>)[name] = () => {
      throw new NetGuardError("a name lookup");
    };
    (dns.promises as unknown as Record<string, unknown>)[name] = () => {
      throw new NetGuardError("a name lookup");
    };
  }
}

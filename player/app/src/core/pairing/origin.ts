// The server's address (ADR 0002, section 6): HTTPS only, except loopback in development. Pure.
// A device token is sent only to an address this accepts, and only to the one that issued it.

export type OriginResult = { readonly ok: true; readonly origin: string } | { readonly ok: false; readonly reason: "unset" | "invalid" };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * An origin and nothing more: a scheme, a host and perhaps a port. No path, query, fragment or
 * user name. `allowLoopbackHttp` is true only in a development run, never in a packaged build.
 */
export function parseBackendOrigin(raw: unknown, allowLoopbackHttp: boolean): OriginResult {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "unset" };
  const text = raw.trim().replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && allowLoopbackHttp && LOOPBACK.has(url.hostname));
  // Equal to its own origin: nothing but scheme, host and port was given, in their plain form.
  if (!secure || url.username !== "" || url.password !== "" || url.origin !== text) return { ok: false, reason: "invalid" };
  return { ok: true, origin: url.origin };
}

/**
 * The pairing page the app may open in the browser: on the server's own origin, with no query
 * and no fragment (the code is typed there, never carried in the address). Null otherwise.
 */
export function pairingPageOn(origin: string, uri: unknown): string | null {
  if (typeof uri !== "string" || uri.length > 200) return null;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  return url.href === uri ? uri : null;
}

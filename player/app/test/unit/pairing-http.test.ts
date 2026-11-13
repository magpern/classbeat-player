// The backend client (main/pairing/http.ts) against a fake backend on loopback: the token goes in
// the Authorization header only, a redirect is never followed, a big or broken body is not read,
// a slow server and a closed port are "unreachable".
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createBackendCall, MAX_BODY_BYTES } from "../../src/main/pairing/http.ts";
import { newToken } from "./pairing-tokens.ts";

type Seen = { method: string; url: string; auth: string | undefined; body: string };
const seen: Seen[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_q, s) => s.end();
let server: Server;
let origin: string;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      handler(req, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => (_q: IncomingMessage, s: ServerResponse) => {
  s.writeHead(status, { "content-type": "application/json", ...headers });
  s.end(JSON.stringify(body));
};

test("a POST carries its JSON body; a token goes in Authorization only, never in the address", async () => {
  seen.length = 0;
  handler = json(400, { error: "authorization_pending" });
  const call = createBackendCall();
  const code = newToken("dc");
  assert.deepEqual(await call({ origin, method: "POST", path: "/api/pairing/token", body: { device_code: code } }), {
    kind: "http",
    status: 400,
    body: { error: "authorization_pending" },
    retryAfterS: null,
  });
  const token = newToken("dev");
  handler = (_q, s) => s.writeHead(204).end();
  assert.deepEqual(await call({ origin, method: "DELETE", path: "/api/player/device", token }), { kind: "http", status: 204, body: undefined, retryAfterS: null });
  assert.deepEqual(seen, [
    { method: "POST", url: "/api/pairing/token", auth: undefined, body: JSON.stringify({ device_code: code }) },
    { method: "DELETE", url: "/api/player/device", auth: `Bearer ${token}`, body: "" },
  ]);
});

test("Retry-After is read as whole seconds", async () => {
  handler = json(429, { error: "too_many_requests" }, { "retry-after": "120" });
  const a = await createBackendCall()({ origin, method: "POST", path: "/api/pairing/start", body: { platform: "linux", version: "0" } });
  assert.equal(a.kind === "http" && a.retryAfterS, 120);
});

test("a redirect is not followed, so the token never goes anywhere else", async () => {
  seen.length = 0;
  handler = (_q, s) => s.writeHead(307, { location: `${origin}/elsewhere` }).end();
  const a = await createBackendCall()({ origin, method: "GET", path: "/api/player/device", token: newToken("dev") });
  assert.equal(a.kind === "http" && a.status, 307);
  assert.deepEqual(seen.map((s) => s.url), ["/api/player/device"]);
});

test("a body over the cap, or not JSON, is not read", async () => {
  handler = (_q, s) => s.writeHead(200, { "content-type": "application/json" }).end(`"${"a".repeat(MAX_BODY_BYTES)}"`);
  const big = await createBackendCall()({ origin, method: "GET", path: "/api/player/device", token: newToken("dev") });
  assert.deepEqual(big, { kind: "http", status: 200, body: undefined, retryAfterS: null });
  handler = (_q, s) => s.writeHead(200).end("<html>");
  const html = await createBackendCall()({ origin, method: "GET", path: "/api/player/device", token: newToken("dev") });
  assert.equal(html.kind === "http" && html.body, undefined);
});

test("a request may raise the cap for an answer with a class document, and is held to it", async () => {
  const text = "a".repeat(MAX_BODY_BYTES);
  handler = (_q, s) => s.writeHead(200, { "content-type": "application/json" }).end(`"${text}"`);
  const raised = await createBackendCall()({ origin, method: "GET", path: "/api/player/device", token: newToken("dev"), maxBodyBytes: 2 * MAX_BODY_BYTES });
  assert.equal(raised.kind === "http" && raised.body, text);
  const held = await createBackendCall()({ origin, method: "GET", path: "/api/player/device", token: newToken("dev"), maxBodyBytes: MAX_BODY_BYTES });
  assert.equal(held.kind === "http" && held.body, undefined);
});

test("a server that does not answer in time, and a closed port, are unreachable", async () => {
  handler = () => undefined;
  assert.deepEqual(await createBackendCall(fetch, 200)({ origin, method: "GET", path: "/api/player/device", token: newToken("dev") }), { kind: "unreachable" });
  const closed = createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((r) => closed.close(() => r()));
  assert.deepEqual(await createBackendCall()({ origin: `http://127.0.0.1:${port}`, method: "GET", path: "/api/player/device" }), { kind: "unreachable" });
});

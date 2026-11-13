// A fake classbeat backend on loopback for the room window's e2e tests (no network): pairing
// answers at once and the account has one class, ID_A, with the given document.
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { newToken } from "../unit/pairing-tokens.ts";
import { changeOf, classBody, ID_A, page as changesPage } from "../unit/sync-fixtures.ts";

const TOKEN = newToken("dev");
const DEVICE_CODE = newToken("dc");

export function fakeBackend(origin: () => string, doc: Record<string, unknown>): Server {
  return createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const send = (status: number, json?: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const route = `${req.method} ${url.pathname}`;
      if (route === "POST /api/pairing/start") return send(200, { device_code: DEVICE_CODE, user_code: "BCDF-GHJK", verification_uri: `${origin()}/pair`, expires_in: 600, interval: 5 });
      if (route === "POST /api/pairing/token") return send(200, { device_token: TOKEN, email: "ann@example.test" });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "token_unknown" });
      if (route === "GET /api/player/device") return send(200, { device: { name: "Studio" } });
      if (route === "GET /api/player/changes") {
        const after = Number(url.searchParams.get("after"));
        return send(200, after >= 1 ? changesPage([], after) : changesPage([changeOf(ID_A, 1, doc)], 1));
      }
      if (route === `GET /api/player/classes/${ID_A}`) return send(200, classBody(ID_A, doc, 1));
      send(404, { error: "not_found" });
    });
  });
}

/** Starts the fake backend on a free loopback port. */
export async function startBackend(doc: Record<string, unknown>): Promise<{ server: Server; origin: string }> {
  let origin = "";
  const server = fakeBackend(() => origin, doc);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, origin };
}

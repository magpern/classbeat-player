// Pairing the built app against a fake backend on loopback (no network): "Pair this computer",
// the code on screen, the site's page "opened" (shell.openExternal is replaced, so no browser
// starts), polls no faster than 5 s, the account shown, then Unpair. Throughout, the device code
// and the token never reach the page, its console, the app's output or a file on disk.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { launch, sleep } from "./launch.ts";

const newToken = (type: string): string => ["cbp", type, randomBytes(32).toString("base64url")].join("_");
const DEVICE_CODE = newToken("dc");
const TOKEN = newToken("dev");
const USER_CODE = "BCDF-GHJK";

type Seen = { at: number; method: string; url: string; auth: string | undefined; body: string };
const seen: Seen[] = [];
let polls = 0;
let server: Server;
let origin: string;

function fakeBackend(): Server {
  return createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      seen.push({ at: Date.now(), method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body });
      const send = (status: number, json?: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      const route = `${req.method} ${req.url}`;
      if (route === "POST /api/pairing/start") return send(200, { device_code: DEVICE_CODE, user_code: USER_CODE, verification_uri: `${origin}/pair`, expires_in: 600, interval: 5 });
      if (route === "POST /api/pairing/token") {
        polls += 1;
        return polls < 2 ? send(400, { error: "authorization_pending" }) : send(200, { device_token: TOKEN, email: "ann@example.test" });
      }
      if (route === "GET /api/player/device") return req.headers.authorization === `Bearer ${TOKEN}` ? send(200, { device: { name: "Studio" } }) : send(401, { error: "invalid_token" });
      if (route === "DELETE /api/player/device") return send(204);
      send(404, { error: "not_found" });
    });
  });
}

let app: ElectronApplication;
let page: Page;
const userData = mkdtempSync(join(tmpdir(), "player-e2e-pairing-"));
const output: string[] = [];
const consoleLines: string[] = [];

before(async () => {
  server = fakeBackend();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ app, page } = await launch({ args: ["--test-memory-keychain"], env: { PLAYER_BACKEND_ORIGIN: origin }, userData }));
  app.process().stdout?.on("data", (c: Buffer) => output.push(c.toString()));
  app.process().stderr?.on("data", (c: Buffer) => output.push(c.toString()));
  page.on("console", (m) => consoleLines.push(m.text()));
  // No browser in a test: the page the app would open is recorded instead.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { openedPages: string[] }).openedPages = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
});
after(async () => {
  await app?.close();
  server?.closeAllConnections();
  server?.close();
});

/** With PLAYER_E2E_SCREENSHOTS set to a folder, each pairing state is saved there for the design review. */
const shot = async (name: string): Promise<void> => {
  const dir = process.env.PLAYER_E2E_SCREENSHOTS;
  if (dir) await page.screenshot({ path: join(dir, `pairing-${name}.png`) });
};
const text = (id: string): Promise<string> => page.locator(`#${id}`).innerText();
const pageHolds = async (): Promise<string> => (await page.content()) + JSON.stringify(await page.evaluate(() => (window as unknown as { player: { pairingState(): Promise<unknown> } }).player.pairingState()));

async function waitFor(cond: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(200);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("pair this computer: the code is shown, the page opened, and the account shown once confirmed", async () => {
  assert.equal(await text("pairing-status"), "Not paired");
  await shot("unpaired");
  await page.click("#pair");
  await waitFor(async () => (await page.locator("#pairing-code").innerText()) === USER_CODE, 5000, "the code");
  await shot("waiting");
  assert.equal(await text("pairing-page"), `${origin}/pair`);
  assert.deepEqual(await app.evaluate(() => (globalThis as unknown as { openedPages: string[] }).openedPages), [`${origin}/pair`]);
  const held = await pageHolds();
  assert.ok(!held.includes(DEVICE_CODE) && !held.includes("cbp_"), "the device code reached the page");
  await waitFor(async () => (await text("pairing-status")).startsWith("Paired with"), 20_000, "the pairing");
  assert.equal(await text("pairing-status"), "Paired with ann@example.test");
  await shot("paired");
  assert.equal(await page.locator("#unpair").isVisible(), true);
  assert.equal(await page.locator("#pair").isVisible(), false);
});

test("polls went no faster than the server's 5 s, and only to the fake backend", () => {
  const start = seen.find((s) => s.url === "/api/pairing/start");
  const tokenPolls = seen.filter((s) => s.url === "/api/pairing/token");
  assert.ok(start);
  assert.equal(tokenPolls.length, 2);
  assert.ok(tokenPolls[0].at - start.at >= 5000, `first poll after ${tokenPolls[0].at - start.at} ms`);
  assert.ok(tokenPolls[1].at - tokenPolls[0].at >= 5000, `second poll after ${tokenPolls[1].at - tokenPolls[0].at} ms`);
  for (const p of tokenPolls) assert.deepEqual(JSON.parse(p.body), { device_code: DEVICE_CODE });
  assert.ok(seen.every((s) => s.auth === undefined || s.url === "/api/player/device"), "the token went to another route");
});

test("unpair: the server is told, and the app is unpaired", async () => {
  await page.click("#unpair");
  await waitFor(async () => (await text("pairing-status")) === "Not paired", 5000, "unpaired");
  assert.equal(await text("pairing-message"), "This computer is no longer paired.");
  await shot("after-unpair");
  await waitFor(async () => seen.some((s) => s.method === "DELETE"), 5000, "the revoke");
  const revoke = seen.find((s) => s.method === "DELETE");
  assert.equal(revoke?.url, "/api/player/device");
  assert.equal(revoke?.auth, `Bearer ${TOKEN}`);
});

test("the token and the device code never reached the page, its console, the app's output or a file", async () => {
  const held = await pageHolds();
  for (const secret of [TOKEN, DEVICE_CODE]) {
    assert.ok(!held.includes(secret), "on the page");
    assert.ok(!consoleLines.join("\n").includes(secret), "in the page's console");
    assert.ok(!output.join("").includes(secret), "in the app's output");
  }
  // Chromium's Singleton* entries are symbolic links to nowhere: only real files are read.
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const st = lstatSync(join(dir, n));
      return st.isDirectory() ? files(join(dir, n)) : st.isFile() ? [join(dir, n)] : [];
    });
  for (const f of files(userData)) {
    const body = readFileSync(f).toString("latin1");
    assert.ok(!body.includes(TOKEN) && !body.includes(DEVICE_CODE), `in ${f}`);
  }
});

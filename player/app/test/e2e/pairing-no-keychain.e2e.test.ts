// Without a system keychain the app refuses to pair, with a clear message, and asks the server
// nothing. Runs where Electron's safeStorage has no keychain (Linux CI: "basic_text"); skipped on
// a machine that has one.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { ElectronApplication, Page } from "playwright-core";
import { launch, sleep } from "./launch.ts";

let app: ElectronApplication;
let page: Page;
let server: Server;
let requests = 0;

before(async () => {
  server = createServer((_q, s) => {
    requests += 1;
    s.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ app, page } = await launch({ env: { PLAYER_BACKEND_ORIGIN: origin } }));
});
after(async () => {
  await app?.close();
  server?.closeAllConnections();
  server?.close();
});

test("no keychain: pairing is refused with a message, and nothing is sent", async (t) => {
  const keychain = await app.evaluate(({ safeStorage }) => ({ available: safeStorage.isEncryptionAvailable(), backend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os" }));
  if (keychain.available && keychain.backend !== "basic_text" && keychain.backend !== "unknown") {
    t.skip(`this machine has a keychain (${keychain.backend})`);
    return;
  }
  await page.click("#pair");
  await sleep(500);
  assert.equal(await page.locator("#pairing-status").innerText(), "Not paired");
  assert.match(await page.locator("#pairing-message").innerText(), /no system keychain/);
  assert.equal(requests, 0);
});

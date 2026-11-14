// The rider page's structure guards (CLAUDE.md, "Pure core first"; rider.md, "Fields and limits"):
// its core imports no DOM or I/O, no source turns a string into markup, the page sends nothing but
// `hello` on the socket and nothing but the join body over HTTP, and nothing reads or writes
// localStorage outside store.ts. The address is only ever replaced, never pushed or assigned, and
// the page carries no content security policy of its own: the backend's header is the only one.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { addressUse } from "../lib/address-guard.ts";
import { hasPolicyMeta, referrerMetas } from "../lib/html-meta.ts";
import { RIDER_ALLOWED, impurities } from "../lib/core-purity.ts";
import { MARKUP } from "../lib/markup-apis.ts";

const RIDER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "rider");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : []));
}
const code = (p: string): string => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("the rider page's structure", () => {
  it("its core (the address, effort_calc, the fields, the join form, the wire, the session, the view) imports no DOM or I/O", () => {
    const dir = join(RIDER, "core");
    const list = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    assert.deepEqual(list.sort(), ["address.ts", "effort-calc.ts", "fields.ts", "join.ts", "session.ts", "view.ts", "wire.ts"]);
    for (const f of list) assert.deepEqual(impurities(f, readFileSync(join(dir, f), "utf8"), RIDER_ALLOWED), [], f);
  });

  it("the rider's allowed list still refuses I/O modules", () => {
    for (const bad of ['import "../store.ts";', 'import "../../companion/socket.ts";', 'import "../../companion/core/wire.ts";', 'import "../net.ts";']) {
      assert.notDeepEqual(impurities("x.ts", bad, RIDER_ALLOWED), [], bad);
    }
  });

  it("no source turns a string into markup", () => {
    for (const p of files(RIDER)) {
      for (const re of MARKUP) assert.doesNotMatch(code(p), re, `${relative(RIDER, p)}: ${re}`);
    }
  });

  it("sends nothing but hello on the socket and nothing but the join request over HTTP", () => {
    for (const p of files(RIDER)) {
      const text = code(p);
      const name = relative(RIDER, p);
      if (name !== "socket.ts") assert.doesNotMatch(text, /\bnew WebSocket\b|\.send\(/, name);
      if (name !== "net.ts") assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|sendBeacon|EventSource/, name);
    }
    const socket = code(join(RIDER, "socket.ts"));
    assert.deepEqual(socket.match(/\w+\.send\(.*\);/g), ["ws.send(helloText(this.token));"]);
    const net = code(join(RIDER, "net.ts"));
    assert.deepEqual(net.match(/fetch\("[^"]*"/g), ['fetch("/api/live/join"']);
    assert.match(net, /JSON\.stringify\(\{ session: send\.session, nickname: send\.nickname \}\)/);
  });

  it("only store.ts touches storage, and the token only sessionStorage", () => {
    for (const p of files(RIDER)) {
      const name = relative(RIDER, p);
      if (name !== "store.ts") assert.doesNotMatch(code(p), /localStorage|sessionStorage|document\.cookie/, name);
    }
    const store = code(join(RIDER, "store.ts"));
    assert.equal(store.match(/localStorage\.setItem/g)?.length, 1);
    assert.match(store, /localStorage\.setItem\(NUMBERS_KEY, text\)/);
  });

  it("only app.ts changes the address, and only in place: no pushState, no assignment to the location", () => {
    // Read from each file's syntax tree (test/lib/address-guard.ts, tested in address-guard.test.ts).
    for (const p of files(RIDER)) {
      const name = relative(RIDER, p);
      const use = addressUse(name, readFileSync(p, "utf8"));
      assert.deepEqual(use.problems, [], name);
      if (name !== "app.ts") assert.deepEqual(use.replaceStateCalls, [], name);
    }
    // Every replaceState puts back a target worked out from the address's own rule or a sent class code.
    assert.deepEqual(addressUse("app.ts", readFileSync(join(RIDER, "app.ts"), "utf8")).replaceStateCalls, [
      'history.replaceState(null, "", target)',
      'history.replaceState(null, "", `${location.pathname}#${r.send.session}`)',
    ]);
  });

  it("the page has no content security policy of its own: the backend's header policy is the only one", () => {
    // A <meta> policy cannot name the site's origin for connect-src, so it could only be looser than
    // the header (rider_page_policy.py); the two would apply together and the meta would add nothing.
    const html = readFileSync(join(RIDER, "index.html"), "utf8");
    // Read by tokenizing the page (test/lib/html-meta.ts), so an entity-encoded name cannot slip by.
    assert.equal(hasPolicyMeta(html), false);
    assert.deepEqual(referrerMetas(html), ["no-referrer"]);
  });
});

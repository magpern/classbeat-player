// The rider page's structure guards (CLAUDE.md, "Pure core first"; rider.md, "Fields and limits"):
// its core imports no DOM or I/O, no source turns a string into markup, the page sends nothing but
// `hello` on the socket and nothing but the join body over HTTP, and nothing reads or writes
// localStorage outside store.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RIDER_ALLOWED, impurities } from "../lib/core-purity.ts";
import { MARKUP } from "../lib/markup-apis.ts";

const RIDER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "rider");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : []));
}
const code = (p: string): string => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("the rider page's structure", () => {
  it("its core (effort_calc, the fields, the join form, the wire, the session, the view) imports no DOM or I/O", () => {
    const dir = join(RIDER, "core");
    const list = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    assert.deepEqual(list.sort(), ["effort-calc.ts", "fields.ts", "join.ts", "session.ts", "view.ts", "wire.ts"]);
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
});

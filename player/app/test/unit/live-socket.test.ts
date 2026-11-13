// The host's WebSocket wrapper (main/live/live-socket.ts) over a stand-in WebSocket: text frames
// only, the close told once, nothing thrown, and our own close not told back. No network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { webSocketConnect } from "../../src/main/live/live-socket.ts";

type Fn = (e: { data?: unknown; code?: number }) => void;
class FakeWs {
  static last: FakeWs;
  readonly listeners = new Map<string, Fn[]>();
  readonly sent: string[] = [];
  closedWith: number | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWs.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close(code?: number) {
    this.closedWith = code ?? null;
  }
  addEventListener(type: string, fn: Fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, e: { data?: unknown; code?: number } = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function open() {
  const events: unknown[] = [];
  const s = webSocketConnect((url) => new FakeWs(url))("wss://player.example.test/api/live/ws", {
    open: () => events.push("open"),
    message: (t) => events.push(["message", t]),
    closed: (c) => events.push(["closed", c]),
  });
  return { s, ws: FakeWs.last, events };
}

test("text frames are passed on, binary ones are not", () => {
  const { ws, events } = open();
  ws.fire("open");
  ws.fire("message", { data: "{}" });
  ws.fire("message", { data: new ArrayBuffer(2) });
  assert.deepEqual(events, ["open", ["message", "{}"]]);
});

test("the close is told once, after an error too; nothing after it", () => {
  const { ws, events } = open();
  ws.fire("error");
  ws.fire("close", { code: 1006 });
  ws.fire("close", { code: 1000 });
  ws.fire("message", { data: "{}" });
  assert.deepEqual(events, [["closed", 1006]]);
});

test("our own close is not told back, and sends after it go nowhere", () => {
  const { s, ws, events } = open();
  s.close();
  assert.equal(ws.closedWith, 1000);
  ws.fire("close", { code: 1000 });
  s.send("x");
  assert.deepEqual(events, []);
  assert.deepEqual(ws.sent, []);
});

test("a constructor that throws is a close, never a throw", async () => {
  class Throws {
    constructor() {
      throw new Error("bad url");
    }
  }
  const events: unknown[] = [];
  webSocketConnect(Throws as never)("x", { open: () => undefined, message: () => undefined, closed: (c) => events.push(c) });
  await Promise.resolve();
  assert.deepEqual(events, [1006]);
});

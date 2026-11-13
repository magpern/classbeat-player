// A fake live process for the e2e tests, on the fake backend's loopback port (room-backend.ts): the
// start route and the host's WebSocket at /api/live/ws, with a minimal WebSocket server of its own
// (RFC 6455 text, close and ping frames; enough for the app's one connection). It welcomes the host
// that says `hello` with the host token it issued, records every message the app sends, and lets a
// test play the live process's side. Loopback only, no network, no real account.
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { ExtraRoute } from "./room-backend.ts";
import { startBackend } from "./room-backend.ts";

export const LIVE_JOIN_CODE = "KXPD-RMTB";
export const LIVE_HOST_TOKEN = `cbp_hst_${randomBytes(32).toString("base64url")}`;
const SESSION_ID = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface FakeLive {
  /** How many times the app asked for a session (`POST /api/live/sessions`). */
  starts: number;
  /** Every message the app sent on the host's connection, parsed. */
  readonly received: Record<string, unknown>[];
  /** Whether a host is in (welcomed) right now. */
  hostIn(): boolean;
  /** Sends the live process's message to the host. */
  push(message: unknown): void;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff]);
  return Buffer.concat([head, payload]);
}

/** Reads whole client frames (always masked) off the buffer; returns what is left over. */
function readFrames(buf: Buffer, on: (opcode: number, payload: Buffer) => void): Buffer {
  for (;;) {
    if (buf.length < 2) return buf;
    const opcode = buf[0]! & 0x0f;
    let len = buf[1]! & 0x7f;
    let at = 2;
    if (len === 126) {
      if (buf.length < 4) return buf;
      len = buf.readUInt16BE(2);
      at = 4;
    } else if (len === 127) {
      if (buf.length < 10) return buf;
      len = Number(buf.readBigUInt64BE(2));
      at = 10;
    }
    if (buf.length < at + 4 + len) return buf;
    const mask = buf.subarray(at, at + 4);
    const payload = Buffer.from(buf.subarray(at + 4, at + 4 + len));
    for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!;
    on(opcode, payload);
    buf = buf.subarray(at + 4 + len);
  }
}

export async function startLiveBackend(doc: Record<string, unknown>): Promise<{ server: Server; origin: string; live: FakeLive }> {
  let host: Duplex | null = null;
  const live: FakeLive = {
    starts: 0,
    received: [],
    hostIn: () => host !== null && !host.destroyed,
    push: (m) => void host?.write(frame(1, Buffer.from(JSON.stringify(m)))),
  };
  const extra: ExtraRoute = (route, _req, send) => {
    if (route !== "POST /api/live/sessions") return false;
    live.starts += 1;
    send(200, { sessionId: SESSION_ID, joinCode: LIVE_JOIN_CODE, hostToken: LIVE_HOST_TOKEN });
    return true;
  };
  const started = await startBackend(doc, extra);
  started.server.on("upgrade", (req, socket: Duplex) => {
    const key = req.headers["sec-websocket-key"];
    if (req.url !== "/api/live/ws" || typeof key !== "string") return void socket.destroy();
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let rest: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      rest = readFrames(Buffer.concat([rest, chunk]), (opcode, payload) => {
        if (opcode === 8) return void socket.end(frame(8, payload.subarray(0, 2)));
        if (opcode === 9) return void socket.write(frame(10, payload));
        if (opcode !== 1) return;
        const m = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;
        live.received.push(m);
        if (m.type === "hello" && m.token === LIVE_HOST_TOKEN) {
          host = socket;
          live.push({ v: 1, type: "welcome", role: "host" });
        }
        // As the live process: the session ends, `ended` goes out and the connection closes with 4403.
        if (m.type === "end" && host === socket) {
          live.push({ v: 1, type: "ended", reason: "host_ended" });
          socket.end(frame(8, Buffer.from([0x11, 0x33])));
        }
      });
    });
    socket.on("close", () => {
      if (host === socket) host = null;
    });
    socket.on("error", () => undefined);
  });
  return { ...started, live };
}

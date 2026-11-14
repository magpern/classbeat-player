// The rider's one WebSocket to the live process, `wss://<site>/api/live/ws` (ADR 0007 section 2).
// The rider token goes only in the first message, `hello`, never in the address; it is the only
// frame this page ever sends (there is no method to send anything else). After a dropped
// connection it tries again by itself with the same token: after 1 and 2 s, then every 5 s
// (rider.md, "Reconnecting"); the waits start again from 1 s only after a connection that was
// welcomed and stayed up for STABLE_MS. A token refused, a session ended or a newer connection
// with the same token is final: no new try. Nothing here logs.
import { CLOSE_ENDED, CLOSE_REFUSED, CLOSE_REPLACED } from "./core/session.ts";
import type { Event } from "./core/session.ts";
import { MAX_FRAME_CHARS, helloText, parseInbound } from "./core/wire.ts";
import { liveUrl } from "../companion/socket.ts";

const RETRY_MS = [1000, 2000];
const RETRY_AFTER_MS = 5000;
export const STABLE_MS = 10_000;
const FINAL = new Set([CLOSE_REFUSED, CLOSE_ENDED, CLOSE_REPLACED]);

export class RiderSocket {
  private ws: WebSocket | null = null;
  private tries = 0;
  private upSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly token: string;
  private readonly emit: (e: Event) => void;
  private readonly now: () => number;

  constructor(token: string, emit: (e: Event) => void, now: () => number) {
    this.token = token;
    this.emit = emit;
    this.now = now;
  }

  start(): void {
    this.connect();
  }

  /** Closes the connection (if any) and makes no new try. */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) this.detach(ws);
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
  }

  /** Drops a connection that has gone quiet; the usual tries follow. */
  restart(): void {
    const ws = this.ws;
    if (!ws || this.stopped) return;
    this.detach(ws);
    ws.close(1000);
    this.closed(1006);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private detach(ws: WebSocket): void {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (this.ws === ws) this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    this.emit({ type: "connecting", at: this.now() });
    let ws: WebSocket;
    try {
      ws = new WebSocket(liveUrl());
    } catch {
      this.closed(1006);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(helloText(this.token));
      this.emit({ type: "opened", at: this.now() });
    };
    ws.onmessage = (m: MessageEvent) => {
      if (typeof m.data !== "string" || m.data.length > MAX_FRAME_CHARS) return;
      const msg = parseInbound(m.data);
      if (!msg) return;
      if (msg.type === "welcome" && this.upSince === null) this.upSince = this.now();
      this.emit({ type: "message", msg, at: this.now() });
    };
    ws.onclose = (c: CloseEvent) => {
      this.detach(ws);
      this.closed(c.code);
    };
  }

  private closed(code: number): void {
    const at = this.now();
    if (this.upSince !== null && at - this.upSince >= STABLE_MS) this.tries = 0;
    this.upSince = null;
    this.emit({ type: "closed", code, at });
    if (this.stopped || FINAL.has(code)) {
      this.stopped = true;
      return;
    }
    const wait = RETRY_MS[this.tries] ?? RETRY_AFTER_MS;
    this.tries += 1;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, wait);
  }
}

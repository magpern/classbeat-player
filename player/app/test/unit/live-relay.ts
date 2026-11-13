// A fake live process for the live client's tests: records the start request and every socket the
// app opens, and lets a test play the server's side (open, messages, close). With a fake clock and
// timers. No network: nothing here opens a socket or a port.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createController } from "../../src/main/controller.ts";
import type { Controller } from "../../src/main/controller.ts";
import type { HttpAnswer } from "../../src/core/pairing/protocol.ts";
import type { BackendRequest } from "../../src/main/pairing/http.ts";
import { createLiveService } from "../../src/main/live/live-service.ts";
import type { LiveService } from "../../src/main/live/live-service.ts";
import type { SocketEvents } from "../../src/main/live/live-socket.ts";
import { converterExamples } from "./fixtures.ts";

export const ORIGIN = "https://player.example.test";
/** Another backend, for a computer paired again elsewhere. */
export const OTHER_ORIGIN = "https://other.example.test";
export const DEVICE_TOKEN = `cbp_dev_${randomBytes(32).toString("base64url")}`;
export const HOST_TOKEN = `cbp_hst_${randomBytes(32).toString("base64url")}`;
export const JOIN_CODE = "BCDF-GHJK";
export const CONTROL_CODE = "QRST-VWXZ";
export const SESSION_ID = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";

export interface FakeSocket {
  readonly url: string;
  readonly sent: unknown[];
  closedByApp: boolean;
  /** Called within the app's `send`, after the message is recorded: a transport that answers at once. */
  onSent: ((message: unknown) => void) | null;
  open(): void;
  server(message: unknown): void;
  drop(code: number): void;
}

export interface Rig {
  readonly live: LiveService;
  readonly controller: Controller;
  readonly requests: BackendRequest[];
  readonly sockets: FakeSocket[];
  /** The last socket the app opened. */
  socket(): FakeSocket;
  /** Moves the fake clock on, running every timer that falls due. */
  advance(ms: number): Promise<void>;
  now(): number;
  secondDisplay: boolean;
  classOpen: boolean;
  answer: HttpAnswer;
  paired: boolean;
  /** The pairing's backend; set it to pair the computer again with another one. */
  origin: string;
  /** The lines the live service logged. */
  readonly logs: string[];
  /** When set, opening a socket throws it (a step after the start answer failing). */
  connectThrows: Error | null;
  /** When set, start answers wait until `release` gives them, each with the answer set when it was asked. */
  holdAnswers: boolean;
  /** Gives the held answer of start request `i` (0 the first). */
  release(i: number): Promise<void>;
  /** The fake clock's timers, for what the tests build beside the live client. */
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export function rig(): Rig {
  let now = 1000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const requests: BackendRequest[] = [];
  const sockets: FakeSocket[] = [];
  const held: (() => void)[] = [];
  const setTimer = (fn: () => void, ms: number): number => {
    ids += 1;
    timers.push({ at: now + ms, fn, id: ids });
    return ids;
  };
  const clearTimer = (h: unknown): void => void (timers = timers.filter((t) => t.id !== h));
  const controller = createController(() => now);
  controller.open("class.json", readFileSync(converterExamples()[0], "utf8"));
  const r: Rig = {
    secondDisplay: true,
    classOpen: true,
    paired: true,
    origin: ORIGIN,
    logs: [],
    connectThrows: null,
    holdAnswers: false,
    async release(i) {
      held[i]();
      await r.advance(0);
    },
    setTimer,
    clearTimer,
    answer: { kind: "http", status: 200, body: { sessionId: SESSION_ID, joinCode: JOIN_CODE, hostToken: HOST_TOKEN }, retryAfterS: null },
    controller,
    requests,
    sockets,
    socket: () => sockets[sockets.length - 1],
    now: () => now,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = timers[0];
        if (next === undefined || next.at > end) break;
        timers = timers.slice(1);
        now = Math.max(now, next.at);
        next.fn();
        await Promise.resolve();
      }
      now = end;
      await new Promise((res) => setImmediate(res));
    },
    live: null as unknown as LiveService,
  };
  (r as { live: LiveService }).live = createLiveService({
    now: () => now,
    runId: () => randomBytes(16).toString("base64url"),
    credential: () => (r.paired ? { origin: r.origin, token: DEVICE_TOKEN, expired: false } : null),
    call: async (req) => {
      requests.push(req);
      const answer = r.answer;
      if (r.holdAnswers) await new Promise<void>((res) => void held.push(res));
      return answer;
    },
    connect: (url, on: SocketEvents) => {
      if (r.connectThrows !== null) throw r.connectThrows;
      const s: FakeSocket = {
        url,
        sent: [],
        closedByApp: false,
        onSent: null,
        open: () => on.open(),
        server: (m) => on.message(JSON.stringify(m)),
        drop: (code) => on.closed(code),
      };
      sockets.push(s);
      return {
        send: (text) => {
          const m: unknown = JSON.parse(text);
          s.sent.push(m);
          s.onSent?.(m);
        },
        close: () => void (s.closedByApp = true),
      };
    },
    host: { read: () => controller.read(), apply: (cmd) => void controller.command(cmd) },
    classOpen: () => r.classOpen,
    secondDisplay: () => r.secondDisplay,
    setTimer,
    clearTimer,
    log: (line) => void r.logs.push(line),
  });
  return r;
}

/** Starts the phone remote and lets the fake server welcome the host. */
export async function started(r: Rig = rig()): Promise<Rig> {
  r.live.start();
  await r.advance(0);
  r.socket().open();
  r.socket().server({ v: 1, type: "welcome", role: "host" });
  return r;
}

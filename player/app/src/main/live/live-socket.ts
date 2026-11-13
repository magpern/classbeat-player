// The host's one outbound WebSocket to the live process (ADR 0005 section 1), from the main
// process only, over the runtime's own WebSocket. Nothing listens on this computer. Text frames
// only; a binary frame is not read. Never logs and never throws: every failure is a close, told
// once. The token is never in the address: it goes in the `hello` message. It imports nothing:
// the code told for a close without one is core's CLOSE_ABNORMAL, handed in by setup.ts, so 1006 is
// defined once (core/live/session-model.ts).

export interface LiveSocket {
  send(text: string): void;
  close(): void;
}

export interface SocketEvents {
  open(): void;
  message(text: string): void;
  /** Told exactly once, with the close code (the `abnormal` code when the connection failed without one). */
  closed(code: number): void;
}

export type Connect = (url: string, on: SocketEvents) => LiveSocket;

/** The part of the WHATWG WebSocket this uses. */
interface RuntimeSocketLike {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: string, fn: (e: { data?: unknown; code?: number }) => void): void;
}
/** Opens one connection; the runtime's WebSocket by default, a stand-in in the tests. */
type OpenSocket = (url: string) => RuntimeSocketLike;

const runtimeSocket: OpenSocket = (url) => new WebSocket(url);

/** `abnormal`: the code told when the connection failed or dropped without a close code of its own. */
export function webSocketConnect(abnormal: number, openSocket: OpenSocket = runtimeSocket): Connect {
  return (url, on) => {
    let done = false;
    const closed = (code: number): void => {
      if (done) return;
      done = true;
      on.closed(code);
    };
    let ws: RuntimeSocketLike;
    try {
      ws = openSocket(url);
    } catch {
      queueMicrotask(() => closed(abnormal));
      return { send: () => undefined, close: () => undefined };
    }
    ws.addEventListener("open", () => {
      if (!done) on.open();
    });
    ws.addEventListener("message", (e) => {
      if (!done && typeof e.data === "string") on.message(e.data);
    });
    ws.addEventListener("close", (e) => closed(typeof e.code === "number" ? e.code : abnormal));
    // An error is always followed by a close; nothing from it is kept (it could quote the request).
    ws.addEventListener("error", () => undefined);
    return {
      send(text) {
        if (done) return;
        try {
          ws.send(text);
        } catch {
          // A send on a closing connection: the close event tells it.
        }
      },
      close() {
        // Our own close is not told back: the caller has already moved on.
        done = true;
        try {
          ws.close(1000);
        } catch {
          // Already closed.
        }
      },
    };
  };
}

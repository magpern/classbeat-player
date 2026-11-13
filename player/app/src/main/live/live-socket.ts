// The host's one outbound WebSocket to the live process (ADR 0005 section 1), from the main
// process only, over the runtime's own WebSocket. Nothing listens on this computer. Text frames
// only; a binary frame is not read. Never logs and never throws: every failure is a close, told
// once. The token is never in the address: it goes in the `hello` message.

export interface LiveSocket {
  send(text: string): void;
  close(): void;
}

export interface SocketEvents {
  open(): void;
  message(text: string): void;
  /** Told exactly once, with the close code (1006 when the connection failed without one). */
  closed(code: number): void;
}

export type Connect = (url: string, on: SocketEvents) => LiveSocket;

/** The part of the WHATWG WebSocket this uses. */
interface WebSocketLike {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: string, fn: (e: { data?: unknown; code?: number }) => void): void;
}
/** Opens one connection; the runtime's WebSocket by default, a stand-in in the tests. */
type OpenSocket = (url: string) => WebSocketLike;

const runtimeSocket: OpenSocket = (url) => new WebSocket(url);

const ABNORMAL = 1006;

export function webSocketConnect(openSocket: OpenSocket = runtimeSocket): Connect {
  return (url, on) => {
    let done = false;
    const closed = (code: number): void => {
      if (done) return;
      done = true;
      on.closed(code);
    };
    let ws: WebSocketLike;
    try {
      ws = openSocket(url);
    } catch {
      queueMicrotask(() => closed(ABNORMAL));
      return { send: () => undefined, close: () => undefined };
    }
    ws.addEventListener("open", () => {
      if (!done) on.open();
    });
    ws.addEventListener("message", (e) => {
      if (!done && typeof e.data === "string") on.message(e.data);
    });
    ws.addEventListener("close", (e) => closed(typeof e.code === "number" ? e.code : ABNORMAL));
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

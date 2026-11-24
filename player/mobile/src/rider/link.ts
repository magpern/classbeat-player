// The rider's live link, seen from the page (issue #633): native code opens it and holds the rider
// token; the page only asks it to open and waits for events, one `receive` at a time. The waits
// between tries are the rider page's (web/src/rider/socket.ts, rider.md "Reconnecting"): 1 and 2 s,
// then every 5 s, from 1 s again only after a connection that was welcomed and stayed up 10 s. A
// final close (token refused, session ended, replaced) makes no new try: native code has already
// dropped the token. A refused `receive` means the rider is no longer joined: the loop ends.
import { CLOSE_ENDED, CLOSE_REFUSED, CLOSE_REPLACED } from "../../../../web/src/rider/core/session.ts";
import { parseEvent } from "./native.ts";
import type { NativeEvent } from "./native.ts";

export const RETRY_MS: readonly number[] = [1000, 2000];
export const RETRY_AFTER_MS = 5000;
export const STABLE_MS = 10_000;
const FINAL = new Set([CLOSE_REFUSED, CLOSE_ENDED, CLOSE_REPLACED]);

/** The two native intents the link uses (bridge.ts). */
export interface LinkIntents {
  open(): Promise<unknown>;
  receive(): Promise<unknown>;
}

export interface Clock {
  now(): number;
  later(fn: () => void, ms: number): () => void;
}

export class NativeLink {
  private stopped = false;
  private tries = 0;
  private upSince: number | null = null;
  private cancel: (() => void) | null = null;
  private readonly intents: LinkIntents;
  private readonly emit: (e: NativeEvent) => void;
  private readonly clock: Clock;

  constructor(intents: LinkIntents, emit: (e: NativeEvent) => void, clock: Clock) {
    this.intents = intents;
    this.emit = emit;
    this.clock = clock;
  }

  start(): void {
    this.open();
    void this.loop();
  }

  /** No new try and no more events: after an ending, or before Leave. */
  stop(): void {
    this.stopped = true;
    this.cancel?.();
    this.cancel = null;
  }

  private open(): void {
    this.cancel = null;
    if (this.stopped) return;
    // A refused open (no token any more, or a link already open) changes nothing here.
    this.intents.open().catch(() => undefined);
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let raw: unknown;
      try {
        raw = await this.intents.receive();
      } catch {
        return;
      }
      if (this.stopped) return;
      const e = parseEvent(raw);
      if (!e) continue;
      this.track(e);
      this.emit(e);
    }
  }

  private track(e: NativeEvent): void {
    if (e.kind === "frame" && e.msg.type === "welcome") this.upSince = this.clock.now();
    if (e.kind !== "closed") return;
    if (this.upSince !== null && this.clock.now() - this.upSince >= STABLE_MS) this.tries = 0;
    this.upSince = null;
    if (FINAL.has(e.code)) return;
    const wait = RETRY_MS[this.tries] ?? RETRY_AFTER_MS;
    this.tries++;
    this.cancel = this.clock.later(() => this.open(), wait);
  }
}

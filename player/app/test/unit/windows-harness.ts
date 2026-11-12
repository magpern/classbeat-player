// A fake helper process and a hand-driven clock for the Windows reader's tests. Nothing here
// starts a process: the reader gets a `startHelper` that hands out fake children, which a test makes
// write lines, hang (write nothing) or die.
import type { HelperChild, SupervisorDeps } from "../../src/main/readers/helper-supervisor.ts";

export class FakeChild implements HelperChild {
  readonly written: string[] = [];
  killed = false;
  private out: ((chunk: string) => void) | null = null;
  private exit: (() => void) | null = null;

  onStdout(cb: (chunk: string) => void): void {
    this.out = cb;
  }
  onExit(cb: () => void): void {
    this.exit = cb;
  }
  write(text: string): void {
    this.written.push(text);
  }
  kill(): void {
    this.killed = true;
  }
  /** The helper writes this to its output, exactly as given (no line end is added). */
  emit(chunk: string): void {
    this.out?.(chunk);
  }
  /** The helper writes one line. */
  line(text: string): void {
    this.emit(`${text}\n`);
  }
  /** The helper process ends. */
  die(): void {
    this.exit?.();
  }
}

export interface Harness {
  readonly deps: SupervisorDeps;
  readonly children: FakeChild[];
  /** The newest helper that was started. */
  readonly child: FakeChild;
  readonly now: number;
  /** Moves the clock forward, running every timer that comes due on the way. */
  advance(ms: number): void;
  /** While true, starting the helper throws (PowerShell missing, say). */
  failSpawn: boolean;
}

export function createHarness(): Harness {
  let now = 1000;
  let seq = 0;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  const children: FakeChild[] = [];
  const h: Harness = {
    children,
    failSpawn: false,
    get child() {
      return children[children.length - 1];
    },
    get now() {
      return now;
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = Math.max(now, due.at);
        due.fn();
      }
      now = end;
    },
    deps: {
      startHelper() {
        if (h.failSpawn) throw new Error("spawn failed");
        const c = new FakeChild();
        children.push(c);
        return c;
      },
      now: () => now,
      setTimer(fn, ms) {
        const id = ++seq;
        timers.push({ id, at: now + ms, fn });
        return id;
      },
      clearTimer(handle) {
        timers = timers.filter((t) => t.id !== handle);
      },
    },
  };
  return h;
}

/**
 * A line as the helper writes it for a session. Times are the system clock's, in ms. `commands`
 * is how many command lines the helper has read from its input so far.
 */
export function sessionLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: "Spotify.exe",
    status: "Playing",
    title: "Spike Song A",
    artist: "Spike Artist",
    positionMs: 12_500,
    startMs: 0,
    endMs: 180_000,
    lastUpdatedUtcMs: 1_794_000_000_000,
    nowUtcMs: 1_794_000_000_800,
    commands: 0,
    ...over,
  });
}

/** No Spotify session, from a helper that has read `commands` command lines. */
export const noSession = (commands = 0): string => `{"app":null,"commands":${commands}}`;
export const NO_SESSION = noSession();
/** Another app is playing while Spotify is not: its id, "Playing" and Spotify's own status, nothing else. */
export const otherApp = (app = "Chrome", spotify = "Paused", commands = 0): string => JSON.stringify({ app, status: "Playing", spotify, commands });
export const OTHER_APP = otherApp();

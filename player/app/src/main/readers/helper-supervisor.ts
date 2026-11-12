// Keeps one long-lived helper process alive for a reader and never lets it hurt the application.
// The helper is untrusted: it may hang, die, flood or write anything. Whatever it does, the
// outcome here is a dropped helper, a call to `onDown`, and a restart after a growing wait.
// Nothing in this module throws, and it knows nothing about what the helper is: starting the
// process is the caller's `spawn`, and judging a line is the caller's `onLine`.

/** A started helper, as the supervisor sees it. None of these may throw. */
export interface HelperChild {
  onStdout(cb: (chunk: string) => void): void;
  /** The process ended, or could not be started. */
  onExit(cb: () => void): void;
  write(text: string): void;
  kill(): void;
}

export interface SupervisorDeps {
  /** Starts the helper. May throw; that counts as a failed start. */
  spawn(): HelperChild;
  /** Monotonic time in ms. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface SupervisorOptions {
  /** The first good line must arrive within this of the start. */
  readonly startTimeoutMs: number;
  /** After that, good lines must keep arriving at least this often. */
  readonly silenceTimeoutMs: number;
  /** This many bad lines in a row and the helper is replaced. */
  readonly maxGarbageLines: number;
  /** Text without a line end longer than this is a flood, and the helper is replaced. */
  readonly maxLineLength: number;
  /** A helper that has run this long and still writes good lines clears the failure count. */
  readonly healthyMs: number;
  /** Never two starts closer than this, whatever asks for them. */
  readonly minGapMs: number;
  /** One complete line. Returns false when it is not a line the helper is meant to write. */
  onLine(line: string): boolean;
  /** The helper was dropped: whatever it last said is no longer backed by a running helper. */
  onDown(): void;
}

export interface Supervisor {
  /** Run the helper from now on, restarting it as needed. */
  start(): void;
  /** Stop the helper and do not restart it. */
  stop(): void;
  /** Writes to the running helper's input. False when no helper is running. */
  write(text: string): boolean;
  readonly running: boolean;
}

const BACKOFF_FIRST_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

/** The wait before the next start after `failures` failures in a row: 1 s, 2 s, 4 s … 30 s. Pure. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** Math.min(failures - 1, 10));
}

export function createSupervisor(deps: SupervisorDeps, opts: SupervisorOptions): Supervisor {
  let wanted = false;
  let child: HelperChild | null = null;
  let buffer = "";
  let garbage = 0;
  let failures = 0;
  let notBefore = Number.NEGATIVE_INFINITY;
  let startedAt = 0;
  let watchdog: unknown = null;
  let restart: unknown = null;

  const cancel = (handle: unknown): null => {
    if (handle !== null) deps.clearTimer(handle);
    return null;
  };

  const watch = (ms: number): void => {
    watchdog = cancel(watchdog);
    watchdog = deps.setTimer(() => {
      watchdog = null;
      fail();
    }, ms);
  };

  /** Lets go of the helper. Its later output and exit are ignored (they no longer match `child`). */
  function drop(): void {
    const c = child;
    child = null;
    buffer = "";
    garbage = 0;
    watchdog = cancel(watchdog);
    c?.kill();
  }

  function fail(): void {
    drop();
    opts.onDown();
    failures += 1;
    notBefore = Math.max(notBefore, deps.now() + backoffMs(failures));
    schedule();
  }

  function schedule(): void {
    if (!wanted || child !== null || restart !== null) return;
    const wait = notBefore - deps.now();
    if (wait <= 0) {
      launch();
      return;
    }
    restart = deps.setTimer(() => {
      restart = null;
      schedule();
    }, wait);
  }

  function launch(): void {
    startedAt = deps.now();
    notBefore = startedAt + opts.minGapMs;
    let c: HelperChild;
    try {
      c = deps.spawn();
    } catch {
      fail();
      return;
    }
    child = c;
    c.onStdout((chunk) => {
      if (child === c) feed(chunk);
    });
    c.onExit(() => {
      if (child === c) fail();
    });
    watch(opts.startTimeoutMs);
  }

  /** False when the line made the supervisor drop the helper. */
  function take(line: string): boolean {
    if (line.trim() === "") return true;
    let good: boolean;
    try {
      good = opts.onLine(line);
    } catch {
      good = false;
    }
    if (good) {
      garbage = 0;
      if (deps.now() - startedAt >= opts.healthyMs) failures = 0;
      watch(opts.silenceTimeoutMs);
      return true;
    }
    garbage += 1;
    if (garbage < opts.maxGarbageLines) return true;
    fail();
    return false;
  }

  function feed(chunk: string): void {
    buffer += chunk;
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!take(line)) return;
    }
    if (buffer.length > opts.maxLineLength) fail();
  }

  return {
    start() {
      if (wanted) return;
      wanted = true;
      schedule();
    },
    stop() {
      wanted = false;
      restart = cancel(restart);
      drop();
    },
    write(text) {
      if (child === null) return false;
      child.write(text);
      return true;
    },
    get running() {
      return child !== null;
    },
  };
}

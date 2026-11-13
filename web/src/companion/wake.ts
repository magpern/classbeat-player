// The screen wake lock (ADR 0005 section 6; companion.md, "Layout"): asked for while the page is
// connected to a class and shown, given back otherwise. The browser drops it when the page is
// hidden, so it is asked for again when the page is shown. Where the browser has none, or refuses
// it, the page says "Set your screen to stay on" on its code page.

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: "release", cb: () => void): void;
}
interface WakeLockApi {
  request(type: "screen"): Promise<Sentinel>;
}

export class ScreenWake {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private asking = false;
  /** False once the browser has shown it cannot keep the screen on. */
  works: boolean;
  private readonly changed: () => void;

  constructor(changed: () => void) {
    this.changed = changed;
    this.works = this.api() !== null;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.ask();
    });
  }

  private api(): WakeLockApi | null {
    const n = navigator as Navigator & { wakeLock?: WakeLockApi };
    return n.wakeLock && typeof n.wakeLock.request === "function" ? n.wakeLock : null;
  }

  /** Keep the screen on (true) or let it sleep (false). */
  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) void this.ask();
    else this.letGo();
  }

  private letGo(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s) void s.release().catch(() => undefined);
  }

  private async ask(): Promise<void> {
    const api = this.api();
    if (!this.wanted || this.sentinel || this.asking || document.visibilityState !== "visible") return;
    if (!api) return;
    this.asking = true;
    try {
      const s = await api.request("screen");
      if (!this.wanted) {
        void s.release().catch(() => undefined);
        return;
      }
      this.sentinel = s;
      s.addEventListener("release", () => {
        if (this.sentinel === s) this.sentinel = null;
      });
    } catch {
      if (this.works) {
        this.works = false;
        this.changed();
      }
    } finally {
      this.asking = false;
    }
  }

  get held(): boolean {
    return this.sentinel !== null;
  }
}

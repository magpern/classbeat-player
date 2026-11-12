// Hand-driven rigs for the macOS and the Linux reader, for the tests of what the readers share
// (issue #51). A fake execFile, clock and timer: nothing here starts a process, and no call is
// answered unless a test answers it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUSCTL, LINUX_CALLS, LINUX_POLL_MS } from "../../src/core/link/linux-calls.ts";
import { MAC_POLL_MS, MAC_SCRIPTS, OSASCRIPT } from "../../src/core/link/macos-scripts.ts";
import type { MusicReader, MusicTransport } from "../../src/core/link/index.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import { createMacMusic } from "../../src/main/macos-reader.ts";
import type { ExecFileFn } from "../../src/main/polled-reader.ts";
import { REPO } from "./fixtures.ts";

export type Reader = MusicReader & MusicTransport & { setActive(on: boolean): void; unavailable(): boolean };

export interface Call {
  /** "read" (Spotify's own reading), "play", "pause", "next", "names" (Linux) or another player's bus name (Linux). */
  readonly what: string;
  /** The call answers with this output. */
  ok(out: string): void;
  /** The call fails. */
  fail(error?: Error): void;
}

export interface Rig {
  readonly system: "macos" | "linux";
  readonly reader: Reader;
  /** Every call made, in order. */
  readonly calls: Call[];
  readonly clock: { t: number };
  /** The poll timer fires. */
  tick(): void;
  /** Moves the clock on by one poll interval and fires the timer. */
  step(): void;
  /** The newest call of that kind; fails the test when there is none. */
  last(what: string): Call;
  count(what: string): number;
  /** One output of the read call for each state, in this system's format. */
  readonly out: { readonly playing: string; readonly paused: string; readonly stopped: string; readonly empty: string };
  /** While true, starting the program fails as if it were not installed. */
  missing: boolean;
}

export const NOT_INSTALLED = (): Error => Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
export const FAILED = (): Error => Object.assign(new Error("exit 1"), { code: 1 });

const linuxFx = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "linux", name), "utf8");
const LINUX_PLAYING = linuxFx("playing.json");
const linuxWhat = (args: readonly string[]): string => {
  for (const [name, list] of Object.entries(LINUX_CALLS)) if (args === list) return name;
  return args[args.indexOf("call") + 1];
};
const macWhat = (args: readonly string[]): string => {
  const script = args.filter((_, i) => i % 2 === 1).join("\n");
  return Object.entries(MAC_SCRIPTS).find(([, lines]) => lines.join("\n") === script)?.[0] ?? assert.fail(`not an allowlisted script: ${script}`);
};

function rig(system: "macos" | "linux"): Rig {
  const calls: Call[] = [];
  const clock = { t: 0 };
  let timers: (() => void)[] = [];
  const self = { missing: false };
  const exec: ExecFileFn = (file, args, _options, done) => {
    assert.equal(file, system === "macos" ? OSASCRIPT : BUSCTL);
    const what = system === "macos" ? macWhat(args) : linuxWhat(args);
    calls.push({ what, ok: (out) => done(null, out), fail: (error = FAILED()) => done(error, "") });
    if (self.missing) done(NOT_INSTALLED(), "");
  };
  const every = (fn: () => void, ms: number): (() => void) => {
    assert.equal(ms, system === "macos" ? MAC_POLL_MS : LINUX_POLL_MS);
    timers.push(fn);
    return () => {
      timers = timers.filter((f) => f !== fn);
    };
  };
  const reader: Reader = system === "macos" ? createMacMusic({ exec, now: () => clock.t, every }) : createLinuxMusic({ exec, now: () => clock.t, every });
  const tick = (): void => timers.forEach((f) => f());
  return {
    system,
    reader,
    calls,
    clock,
    tick,
    step() {
      clock.t += 250;
      tick();
    },
    last: (what) => calls.findLast((c) => c.what === what) ?? assert.fail(`no ${what} call`),
    count: (what) => calls.filter((c) => c.what === what).length,
    out:
      system === "macos"
        ? { playing: "playing\tspotify:track:X\tSong\tArtist\t10.0\t180000\n", paused: "paused\tspotify:track:X\tSong\tArtist\t10.0\t180000\n", stopped: "stopped\n", empty: "playing\t\t\t\t0\t0\n" }
        : {
            playing: LINUX_PLAYING,
            paused: linuxFx("paused.json"),
            stopped: linuxFx("stopped.json"),
            empty: LINUX_PLAYING.replace(/"Metadata":\{"type":"a\{sv\}","data":\{.*?\}\}\},"Rate"/, '"Metadata":{"type":"a{sv}","data":{}},"Rate"'),
          },
    get missing() {
      return self.missing;
    },
    set missing(on: boolean) {
      self.missing = on;
    },
  };
}

export const macRig = (): Rig => rig("macos");
export const linuxRig = (): Rig => rig("linux");
export const RIGS: readonly (readonly [string, () => Rig])[] = [
  ["macOS", macRig],
  ["Linux", linuxRig],
];

/** The bus's answer to the names call: these players beside Spotify. */
export const busNames = (...players: string[]): string => `${JSON.stringify({ type: "as", data: [["org.freedesktop.DBus", ":1.4", "org.mpris.MediaPlayer2.spotify", ...players]] })}\n`;

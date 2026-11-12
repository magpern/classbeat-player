// A fake session bus for the Linux reader's tests: Spotify and other players, answered by a
// fake execFile. Nothing here starts a process or talks to a D-Bus.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LinkPlan } from "../../src/core/link/index.ts";
import { BUSCTL, LINUX_CALLS } from "../../src/core/link/linux-calls.ts";
import { createLinuxMusic } from "../../src/main/linux-reader.ts";
import type { ExecFileFn } from "../../src/main/linux-reader.ts";
import { REPO } from "./fixtures.ts";

const fx = (name: string): string => readFileSync(join(REPO, "player", "app", "test", "fixtures", "linux", name), "utf8");
export const PLAYING = fx("playing.json");
export const PAUSED = fx("paused.json");
export const STOPPED = fx("stopped.json");
export const VLC = "org.mpris.MediaPlayer2.vlc";
export const FIREFOX = "org.mpris.MediaPlayer2.firefox.instance_1_84";
export const names = (list: readonly unknown[]): string => `${JSON.stringify({ type: "as", data: [list] })}\n`;
export const FAILED = Object.assign(new Error("Call failed"), { code: 1 });
// A class that holds the very recording the fixtures play, by title, artist, length and id.
const SONG = { index: 0, title: "Spike Song A", artist: "Spike Artist", lengthMs: 180_000, startMs: 0, endMs: 171_000, trackIds: ["SPIKEEXAMPLE0001"] };
export const PLAN: LinkPlan = { songs: [SONG], plannedCrossfadeMs: 9000, manualOnly: false };

export type Answer = string | Error | null;

/**
 * A session bus with Spotify and other players. `spotify` and each player's entry are what the
 * read call gets: text, an error, or null for a call left unanswered. Commands are answered at
 * once. `asked` lists every call made, by its destination and last argument.
 */
export function bus(state: { spotify: Answer; players?: Record<string, Answer>; list?: Answer }) {
  const asked: string[] = [];
  const runs: (readonly string[])[] = [];
  const clock = { t: 0, step: 0 };
  let poll: () => void = () => undefined;
  const reply = (a: Answer, done: (e: Error | null, out: string) => void): void => {
    clock.t += clock.step;
    if (a === null) return;
    if (typeof a === "string") done(null, a);
    else done(a, "");
  };
  const exec: ExecFileFn = (file, args, _options, done) => {
    assert.equal(file, BUSCTL);
    runs.push(args);
    const dest = args[args.indexOf("call") + 1];
    asked.push(`${dest} ${args.at(-1)}`);
    if (args === LINUX_CALLS.names) return reply(state.list === undefined ? names(["org.freedesktop.DBus", ":1.4", "org.mpris.MediaPlayer2.spotify", ...Object.keys(state.players ?? {})]) : state.list, done);
    if (args === LINUX_CALLS.read) return reply(state.spotify, done);
    if (dest === "org.mpris.MediaPlayer2.spotify") return done(null, "");
    reply(state.players?.[dest] ?? FAILED, done);
  };
  const linux = createLinuxMusic({ exec, now: () => clock.t, every: (fn) => ((poll = fn), () => undefined) });
  return { linux, asked, runs, clock, state, poll: () => poll() };
}

export const READ = "org.mpris.MediaPlayer2.spotify org.mpris.MediaPlayer2.Player";
export const LIST = "org.freedesktop.DBus ListNames";
export const other = (name: string): string => `${name} org.mpris.MediaPlayer2.Player`;

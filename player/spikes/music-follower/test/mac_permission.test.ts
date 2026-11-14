// macOS Automation prompt: waiting, "not permitted" and the reason on the status line.
// A fake command runner stands in for osascript; nothing here runs the real one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pendingNote, statusLine } from "../src/core/log_format.js";
import type { Decision } from "../src/core/types.js";
import type { ExecResult, Runner } from "../src/readers/exec.js";
import { makeShutdown } from "../src/shutdown.js";
import { MAC_SCRIPT_LINES, MacReader, NOT_PERMITTED_NOTE, OSASCRIPT_TIMEOUT_MS, PERMISSION_WAIT_MS, WAITING_NOTE } from "../src/readers/macos.js";

const PLAYING = "playing\tspotify:track:abc\tSong\tArtist\t12.5\t200000\n";
const ok = (stdout: string): ExecResult => ({ ok: true, stdout, stderr: "", timedOut: false });
const denied: ExecResult = { ok: false, stdout: "", stderr: "execution error: Not authorized to send Apple events to Spotify. (-1743)", timedOut: false };

function fake(...answers: ExecResult[]): { run: Runner; timeouts: number[]; notes: string[]; note: (t: string) => void } {
  const timeouts: number[] = [];
  const notes: string[] = [];
  let i = 0;
  const run: Runner = async (_f, _a, t) => {
    timeouts.push(t);
    return answers[Math.min(i++, answers.length - 1)]!;
  };
  return { run, timeouts, notes, note: (t) => notes.push(t) };
}

describe("macOS permission", () => {
  it("waits for the prompt: the first read has no 700 ms kill, later reads do", async () => {
    const f = fake(ok(PLAYING));
    const r = new MacReader(f.run, f.note);
    await r.prepare();
    await r.readNow();
    assert.deepEqual(f.notes, [WAITING_NOTE]);
    assert.equal(f.timeouts[0], PERMISSION_WAIT_MS);
    assert.ok(PERMISSION_WAIT_MS > 60_000);
    assert.equal(f.timeouts[1], OSASCRIPT_TIMEOUT_MS);
  });

  it("keeps the long wait while Spotify is not running (no answer yet proves nothing)", async () => {
    const f = fake(ok("notrunning\n"));
    const r = new MacReader(f.run, f.note);
    await r.prepare();
    await r.readNow();
    assert.deepEqual(f.timeouts, [PERMISSION_WAIT_MS, PERMISSION_WAIT_MS]);
  });

  it("prints the settings path once on -1743 and keeps running", async () => {
    const f = fake(denied, denied, denied, ok(PLAYING));
    const r = new MacReader(f.run, f.note);
    await r.prepare();
    assert.equal(await r.readNow(), null);
    assert.equal(await r.readNow(), null);
    assert.deepEqual(f.notes, [WAITING_NOTE, NOT_PERMITTED_NOTE]);
    assert.match(NOT_PERMITTED_NOTE, /System Settings, Privacy & Security, Automation/);
    assert.match(NOT_PERMITTED_NOTE, /-1743/);
    assert.equal(r.reason(), "not permitted by macOS (Automation)");
    assert.notEqual(await r.readNow(), null); // allowed later: it picks up
    assert.equal(r.reason(), null);
  });
});

describe("why there is no reading", () => {
  const cases: [string, ExecResult, string | null][] = [
    ["not running", ok("notrunning\n"), "Spotify is not running"],
    ["stopped", ok("stopped\n"), "Spotify is not playing"],
    ["paused", ok("paused\tspotify:track:abc\tSong\tArtist\t1\t200000\n"), "Spotify is paused"],
    ["not permitted", denied, "not permitted by macOS (Automation)"],
    ["slow Spotify", { ok: false, stdout: "", stderr: "", timedOut: true }, "Spotify is not answering"],
    ["other failure", { ok: false, stdout: "", stderr: "boom", timedOut: false }, "osascript failed"],
    ["playing", ok(PLAYING), null],
  ];
  for (const [name, answer, why] of cases) {
    it(name, async () => {
      const r = new MacReader(fake(answer).run);
      await r.readNow();
      assert.equal(r.reason(), why);
    });
  }

  it("the status line carries the reason", () => {
    const d = { classTimeMs: 0, state: "Manual", held: false, songIndex: null, announce: null, candidates: [] } as unknown as Decision;
    assert.match(statusLine(d, "Spotify is not running"), /^00:00 {2}Manual.*\[no music reading: Spotify is not running\]$/);
    assert.doesNotMatch(statusLine(d, null), /no music reading/);
  });
});

describe("a read that never settles", () => {
  const never: Runner = () => new Promise<ExecResult>(() => {});

  it("is abandoned after its timeout and says Spotify is not answering", async () => {
    const r = new MacReader(never, () => {}, { short: 20, long: 20 });
    const started = Date.now();
    assert.equal(await r.readNow(), null);
    assert.ok(Date.now() - started < 2000);
    assert.equal(r.reason(), "Spotify is not answering");
  });

  it("prepare does not hang on a runner that never answers", async () => {
    const r = new MacReader(never, () => {}, { short: 20, long: 20 });
    await r.prepare();
    assert.equal(r.reason(), "Spotify is not answering");
  });

  it("the status line says it is waiting once a read is pending", () => {
    assert.equal(pendingNote(500), "");
    assert.match(pendingNote(3200), /waiting for Spotify's answer, 3 s/);
  });
});

describe("quit", () => {
  it("writes the end line and exits at once, without waiting for any read", () => {
    const calls: string[] = [];
    const quit = makeShutdown(() => calls.push("end"), (c) => calls.push("exit" + c));
    quit();
    assert.deepEqual(calls, ["end", "exit0"]);
  });

  it("exits even if writing the end line fails, and a second press exits straight away", () => {
    const calls: string[] = [];
    const quit = makeShutdown(
      () => {
        calls.push("end");
        throw new Error("disk");
      },
      (c) => calls.push("exit" + c),
    );
    quit();
    quit();
    assert.deepEqual(calls, ["end", "exit0", "exit0"]);
  });
});

describe("read-only guard", () => {
  it("the script sends no control command", () => {
    const script = MAC_SCRIPT_LINES.join("\n");
    assert.doesNotMatch(script, /\b(?:play|pause|playpause|next track|previous track|activate|launch|set player)\b(?! state| position)/i);
  });
});

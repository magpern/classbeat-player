import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildPlan } from "../src/core/class_plan.js";
import { matchCandidates } from "../src/core/match.js";
import { linuxCommand, parseLinuxOutput } from "../src/readers/linux.js";
import { macCommand, MAC_SCRIPT_LINES, parseMacOutput } from "../src/readers/macos.js";
import { parseWindowsLine, windowsCommand } from "../src/readers/windows.js";
import { windowsScript } from "../src/readers/windows_script.js";
import { plan } from "./helpers.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
// Samples are written from the documented output formats, not captured from a real machine yet.

describe("macOS reader", () => {
  it("builds one osascript call that only reads, and never starts Spotify", () => {
    const { file, args } = macCommand();
    assert.equal(file, "osascript");
    assert.equal(args.filter((a) => a === "-e").length, MAC_SCRIPT_LINES.length);
    const script = MAC_SCRIPT_LINES.join("\n");
    assert.match(script, /is not running then return "notrunning"/);
    assert.doesNotMatch(script, /\b(play|pause|next track|previous track|activate|launch|run)\b/);
  });

  it("parses a playing sample with a decimal comma", () => {
    const r = parseMacOutput(fx("mac_playing.txt"), 1000, 1010)!;
    assert.deepEqual([r.trackId, r.title, r.artist, r.positionMs, r.durationMs, r.state], ["spotify:track:SPIKEEXAMPLE0001", "Spike Song A", "Spike Artist", 12500, 180000, "playing"]);
    assert.deepEqual([r.readAtMs, r.polledAtMs], [1000, 1010]);
  });

  it("parses a paused sample with a decimal point, and ignores not-running and stopped", () => {
    const r = parseMacOutput(fx("mac_paused.txt"), 0, 0)!;
    assert.equal(r.state, "paused");
    assert.equal(r.positionMs, 61250);
    assert.equal(parseMacOutput("notrunning\n", 0, 0), null);
    assert.equal(parseMacOutput("stopped\n", 0, 0), null);
  });

  it("matches the class by id", () => {
    assert.deepEqual(matchCandidates(plan, parseMacOutput(fx("mac_playing.txt"), 0, 0)!), [0]);
  });
});

describe("Windows reader", () => {
  it("encodes a script that reads the transport-controls session and sends no commands", () => {
    const { file, args } = windowsCommand(250);
    assert.equal(file, "powershell.exe");
    const decoded = Buffer.from(args[args.length - 1]!, "base64").toString("utf16le");
    assert.equal(decoded, windowsScript(250));
    assert.match(decoded, /GlobalSystemMediaTransportControlsSessionManager/);
    assert.match(decoded, /LastUpdatedTime/);
    assert.match(decoded, /Start-Sleep -Milliseconds 250/);
    assert.doesNotMatch(decoded, /Try(Play|Pause|Skip|Change|Stop|Toggle)\w*Async/);
  });

  it("extrapolates from the reading's own timestamp: a playing position is as old as LastUpdatedTime", () => {
    const r = parseWindowsLine(fx("windows_playing.json"), 5000)!;
    assert.equal(r.state, "playing");
    assert.equal(r.positionMs, 12500);
    assert.equal(r.readAtMs, 5000 - 800);
    assert.equal(r.polledAtMs, 5000);
    assert.equal(r.durationMs, 180000);
    assert.equal(r.trackId, null);
    assert.deepEqual(matchCandidates(plan, r), [0]);
  });

  it("takes a paused position as valid now, whatever LastUpdatedTime says", () => {
    const r = parseWindowsLine(fx("windows_paused.json"), 5000)!;
    assert.equal(r.state, "paused");
    assert.equal(r.readAtMs, 5000);
    assert.deepEqual(matchCandidates(plan, r), [1, 3]);
  });

  it("sets the console to UTF-8 without a byte-order mark before printing anything", () => {
    const script = windowsScript(250);
    const enc = script.indexOf("[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false");
    assert.ok(enc >= 0);
    assert.ok(enc < script.indexOf("ConvertTo-Json"));
  });

  it("keeps non-ASCII titles and artists intact (also after a stray byte-order mark) and matches them", () => {
    const unicodePlan = buildPlan({ crossfadeMs: 0, songs: [{ title: "Älskar dig – Sång å Köln", artist: "Björk", durationMs: 200000 }] });
    for (const line of [fx("windows_unicode.json"), "\uFEFF" + fx("windows_unicode.json")]) {
      const r = parseWindowsLine(line, 1000)!;
      assert.equal(r.title, "Älskar dig – Sång å Köln");
      assert.equal(r.artist, "Björk");
      assert.deepEqual(matchCandidates(unicodePlan, r), [0]);
    }
  });

  it("asks for the current session too, and an app that is not Spotify never matches the class", () => {
    assert.match(windowsScript(250), /GetCurrentSession\(\)/);
    const r = parseWindowsLine(fx("windows_other_app.json"), 1000)!;
    assert.equal(r.app, "Chrome");
    assert.equal(r.title, "Spike Song A"); // even with a class title, it is another app
    assert.deepEqual(matchCandidates(plan, r), []);
    assert.equal(parseWindowsLine(fx("windows_playing.json"), 1000)!.app, null);
  });

  it("ignores no-session and garbage lines", () => {
    assert.equal(parseWindowsLine("none", 0), null);
    assert.equal(parseWindowsLine("{broken", 0), null);
  });
});

describe("limits of the readers", () => {
  it("macOS and Linux readers say that another app playing cannot be observed", async () => {
    const { MacReader } = await import("../src/readers/macos.js");
    const { LinuxReader } = await import("../src/readers/linux.js");
    assert.deepEqual(new MacReader().limitations, ["another-app-playing"]);
    assert.deepEqual(new LinuxReader().limitations, ["another-app-playing"]);
  });
});

describe("Linux reader", () => {
  it("asks playerctl for the Spotify player only", () => {
    const { file, args } = linuxCommand();
    assert.equal(file, "playerctl");
    assert.deepEqual(args.slice(0, 3), ["-p", "spotify", "metadata"]);
  });

  it("parses a sample (microseconds) and matches the class by id", () => {
    const r = parseLinuxOutput(fx("linux_playing.txt"), 10, 20)!;
    assert.equal(r.positionMs, 12500);
    assert.equal(r.durationMs, 180000);
    assert.equal(r.state, "playing");
    assert.deepEqual(matchCandidates(plan, r), [0]);
  });
});

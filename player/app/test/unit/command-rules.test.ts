// Rule guards for the music app's commands from the phone (issue #857, ADR 0011 §6, rule 3): the
// page reaches play, pause and next through three fixed intents with no argument (sendPlay,
// sendPause, sendNext: nothing on the phone plays, so no intent is called `play`), and native code
// knows exactly those three commands. No seek, stop, volume or any other command exists, and the
// page never names one by text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TRANSPORT_ACTIONS } from "../../src/core/link/transport.ts";
import { KT_FOLLOW, type KtMutation, ktViews, MAIN_ACTIVITY, MOBILE, mobileKt, mutationGaps, SESSION_READER, type Views } from "./rule-sources.ts";

const KT_MODE = [...KT_FOLLOW.slice(0, -1), "mode"];
const KT_POLICY = [...KT_FOLLOW.slice(0, -1), "policy"];
const PURE_READER = join(...KT_FOLLOW, "SessionReader.kt");
const FOLLOWER = join(...KT_FOLLOW, "Follower.kt");
const FOLLOW_BRIDGE = join(...KT_MODE, "FollowBridge.kt");
const MODE_PLUGINS = join(...KT_MODE, "ModePlugins.kt");
const INTENT_POLICY = join(...KT_POLICY, "IntentPolicy.kt");
const COMMANDS = ["play", "pause", "next"] as const;
const UPPER = { play: "PLAY", pause: "PAUSE", next: "NEXT" } as const;
const INTENT = { play: "sendPlay", pause: "sendPause", next: "sendNext" } as const;

// The only main sources that may name the commands' type: the pure reader that declares it, the
// Android session that maps each to the music app's own control, and the path from the page to it.
const NAMING = [PURE_READER, SESSION_READER, join(...KT_FOLLOW, "MusicSource.kt"), FOLLOWER, FOLLOW_BRIDGE].sort();
const isMain = (path: string): boolean => path.split(/[\\/]/).slice(0, 4).join("/") === "android/app/src/main";

const DECLARED = /\b(?:class|object|interface|typealias)\s+TransportCommand\b/g;
const THE_ENUM = /^enum class TransportCommand \{ PLAY, PAUSE, NEXT \}$/gm;
const count = (v: string, re: RegExp): number => [...v.matchAll(re)].length;

/** The type is declared once, in the pure reader, with exactly three values. True when not. */
const badEnum = (path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some((v) => (path === PURE_READER ? count(v, DECLARED) !== 1 || count(v, THE_ENUM) !== 1 : count(v, DECLARED) !== 0));

// A value reached any way but by its name: by text, by index, through all values, or under another name.
const OTHER_WAY = /enumValueOf\s*<\s*TransportCommand|TransportCommand\s*(?:\.|::)\s*\*|\bTransportCommand\s+as\b/;
/** Only PLAY, PAUSE and NEXT are reached on the type. True when anything else is. */
const otherMember = (_path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some((v) => OTHER_WAY.test(v) || [...v.matchAll(/\bTransportCommand\s*(?:\?\.|\.|::)\s*(\w+)/g)].some((m) => !["PLAY", "PAUSE", "NEXT"].includes(m[1]!)));

/** Only the listed sources name the type. True when another one does. */
const namesCommands = (path: string, text: string, views: Views = ktViews): boolean =>
  isMain(path) && !NAMING.includes(path) && views(text).some((v) => /\bTransportCommand\b/.test(v));

/** FollowBridge: each intent sends its own one command, and nothing else names one. True when not. */
const bridgeMismatch = (_path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some((v) => {
    const pairs = [...v.matchAll(/fun (\w+)\(call: PluginCall\) = command\(TransportCommand\.(\w+), send\(call\)\)/g)].map((m) => `${m[1]}:${m[2]}`);
    return pairs.sort().join(",") !== COMMANDS.map((c) => `${INTENT[c]}:${UPPER[c]}`).sort().join(",") || count(v, /\bTransportCommand\s*\./g) !== 3 || count(v, /\bfollower\.command\(/g) !== 1;
  });

/** ModePlugins: play, pause and next each reach their own bridge method, once. True when not. */
const pluginMismatch = (_path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some(
    (v) =>
      COMMANDS.some((c) => count(v, new RegExp(`^ {4}fun ${INTENT[c]}\\(call: PluginCall\\) = handle\\(call\\) \\{ c, k -> c\\.follow\\.${INTENT[c]}\\(k\\) \\}$`, "gm")) !== 1) ||
      count(v, /\.follow\.(?:send\w*|play|pause|next|command)\b/g) !== 3,
  );

// Transport words that must never be an intent's name, nor any other "send…" intent.
const OTHER_TRANSPORT = /"(?!(?:sendPlay|sendPause|sendNext)")(?:send\w*|play|pause|next|seek\w*|stop|previous|skip\w*|rewind|fastForward|setVolume\w*|volume|playPause|command|transport)"\s+to\s+Spec\b/i;
/** IntentPolicy: three instructor intents with no argument, and no other transport intent. True when not. */
const policyMismatch = (_path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some((v) => COMMANDS.some((c) => count(v, new RegExp(`^ {8}"${INTENT[c]}" to Spec\\(Mode\\.INSTRUCTOR, emptyMap\\(\\)\\),$`, "gm")) !== 1 || count(v, new RegExp(`"${INTENT[c]}"\\s+to\\b`, "g")) !== 1) || OTHER_TRANSPORT.test(v));

const ktText = (path: string): string => mobileKt.find((s) => s.path === path)!.text;

// The app's own sources; the unit tests may walk every value to test each one.
const mainKt = mobileKt.filter((s) => isMain(s.path));

test("native code has exactly three music commands, declared once and reached only by name", () => {
  assert.ok(mainKt.length > 10, "the main sources are found");
  assert.deepEqual(mainKt.filter((s) => badEnum(s.path, s.text)).map((s) => s.path), []);
  assert.deepEqual(mainKt.filter((s) => otherMember(s.path, s.text)).map((s) => s.path), []);
  assert.deepEqual(mainKt.filter((s) => namesCommands(s.path, s.text)).map((s) => s.path), []);
  assert.deepEqual(mainKt.filter((s) => /\bTransportCommand\b/.test(s.text)).map((s) => s.path).sort(), NAMING);
  for (const bad of ['TransportCommand.valueOf("SEEK")', "TransportCommand.entries[0]", "TransportCommand.values()", 'enumValueOf<TransportCommand>("STOP")', "TransportCommand::valueOf", "import x.TransportCommand.*", "import x.TransportCommand as T"]) {
    assert.ok(otherMember("x.kt", bad), bad);
  }
});

test("each transport intent reaches its own command, and the policy holds no other", () => {
  assert.ok(!bridgeMismatch(FOLLOW_BRIDGE, ktText(FOLLOW_BRIDGE)));
  assert.ok(!pluginMismatch(MODE_PLUGINS, ktText(MODE_PLUGINS)));
  assert.ok(!policyMismatch(INTENT_POLICY, ktText(INTENT_POLICY)));
});

// Each check fails on a real change to the file it guards, and on code a string's "//" hides from `code`.
const W = "val webView = bridge.webView";
const ENUM = "enum class TransportCommand { PLAY, PAUSE, NEXT }";
const FC = "fun command(command: TransportCommand): Map<String, Any?> {";
const READING = "fun reading(call: PluginCall) = reading(send(call))";
const NEXT_PLUGIN = "fun sendNext(call: PluginCall) = handle(call) { c, k -> c.follow.sendNext(k) }";
const NEXT_SPEC = '"sendNext" to Spec(Mode.INSTRUCTOR, emptyMap()),';
// Hidden code goes on a line no anchored pattern reads, so only the "//" can hide it.
const READING_PLUGIN = "fun reading(call: PluginCall) = handle(call) { c, k -> c.follow.reading(k) }";
const READING_SPEC = '"reading" to Spec(Mode.INSTRUCTOR, emptyMap()),';
const MUTATIONS: readonly KtMutation[] = [
  ["the enum", PURE_READER, ENUM, "enum class TransportCommand { PLAY, PAUSE, NEXT, SEEK }", false],
  ["the enum", MAIN_ACTIVITY, W, `${W}; val s = "//"; enum class TransportCommand { STOP }`, true],
  ["the members", FOLLOWER, FC, `${FC} val t = TransportCommand.valueOf("STOP")`, false],
  ["the members", FOLLOWER, FC, `${FC} val s = "//"; val t = TransportCommand.entries`, true],
  ["who names it", MAIN_ACTIVITY, W, `${W}; val s = "//"; follower.command(TransportCommand.NEXT)`, true],
  ["the bridge", FOLLOW_BRIDGE, "command(TransportCommand.NEXT, send(call))", "command(TransportCommand.PLAY, send(call))", false],
  ["the bridge", FOLLOW_BRIDGE, READING, `${READING}; val s = "//"; fun sendSeek(call: PluginCall) = command(TransportCommand.NEXT, send(call))`, true],
  ["the plugin", MODE_PLUGINS, NEXT_PLUGIN, NEXT_PLUGIN.replace("follow.sendNext", "follow.sendPlay"), false],
  ["the plugin", MODE_PLUGINS, READING_PLUGIN, `${READING_PLUGIN}; val s = "//"; fun sendSeek(call: PluginCall) = handle(call) { c, k -> c.follow.sendNext(k) }`, true],
  ["the policy", INTENT_POLICY, NEXT_SPEC, '"next" to Spec(Mode.INSTRUCTOR, mapOf("position" to Arg.NUMBER)),', false],
  ["the policy", INTENT_POLICY, NEXT_SPEC, `${NEXT_SPEC} "seekTo" to Spec(Mode.INSTRUCTOR, emptyMap()),`, false],
  ["the policy", INTENT_POLICY, NEXT_SPEC, `${NEXT_SPEC} "play" to Spec(Mode.INSTRUCTOR, emptyMap()),`, false],
  ["the policy", INTENT_POLICY, READING_SPEC, `${READING_SPEC} val s = "//"; "sendStop" to Spec(Mode.INSTRUCTOR, emptyMap()),`, true],
];

test("the command checks catch each change, and code a string's \"//\" hides", () => {
  const checks = new Map([
    ["the enum", badEnum],
    ["the members", otherMember],
    ["who names it", namesCommands],
    ["the bridge", bridgeMismatch],
    ["the plugin", pluginMismatch],
    ["the policy", policyMismatch],
  ]);
  assert.deepEqual(mutationGaps(MUTATIONS, checks), []);
  assert.deepEqual([...new Set(MUTATIONS.map(([c]) => c))].sort(), [...checks.keys()].sort());
});

test("the page names only the three actions, each mapped to its own intent", () => {
  assert.deepEqual([...TRANSPORT_ACTIONS], [...COMMANDS]);
  const reader = readFileSync(join(MOBILE, "src", "follow", "android-reader.ts"), "utf8");
  const table = /const COMMANDS\b[^\n]*= Object\.freeze\(\{([\s\S]*?)\}\);/.exec(reader);
  assert.ok(table, "the command table is there");
  const rows = table[1]!.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  assert.deepEqual(rows, COMMANDS.map((c) => `${c}: (i: FollowIntents) => i.${INTENT[c]}(),`));
  // The intents are reached only through the table, and the action is checked before it is used.
  assert.equal(count(reader, /\bCOMMANDS\[/g), 1);
  assert.match(reader, /if \(!isTransportAction\(action\)\) return taken\(\);/);
  assert.doesNotMatch(reader, /intents\s*\[|\bi\s*\[/);
});

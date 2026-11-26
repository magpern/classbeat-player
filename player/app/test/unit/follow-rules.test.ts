// Rule guards for following the music app (ADR 0011 §6–§8, rule 3), moved from rules.test.ts: only
// the session reader reads a media session, filtered to the music app and reading only the track,
// the state and the position; the notification listener stays empty.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { kotlinCode, kotlinNames, kotlinSource } from "./kotlin-lex.ts";
import { code, KT_FOLLOW, ktFile, type KtMutation, ktViews, MAIN_ACTIVITY, mobileKt, mutationGaps, SESSION_READER, type Views } from "./rule-sources.ts";

// What only the session reader may name: the media-session types and calls, in any form, so no
// other file reads a session through a value it got without naming a type.
const SESSION_NAMES =
  /MediaController|MediaMetadata|PlaybackState|TransportControls|transportControls|ActiveSessions|MediaSessionManager|MEDIA_SESSION_SERVICE|METADATA_KEY|sessionToken|SessionToken|playbackState|\.metadata\b/;
// How the reader may get a session: only the listed ones, filtered on the package before anything else.
const SESSION_FILTERED = /getActiveSessions\(listener\)\?\.filter \{ it\.packageName == MUSIC_APP \}/g;
const SESSION_OTHER_WAYS =
  /OnActiveSessionsChangedListener|Session2Token|MediaKeyEventSession|NotificationListenerSessions|MediaController\s*\(|MediaSession\.Token|addOnSession|\bToken\b/;
// Every read of a session, and of its metadata beyond the four keys it needs.
const SESSION_READ =
  /\.(?:metadata|playbackState|transportControls|playbackInfo|queue|queueTitle|extras|sessionActivity|ratingType|flags|sessionInfo|tag)\b|\bget(?:Metadata|PlaybackState|TransportControls|PlaybackInfo|Queue|QueueTitle|Extras|SessionActivity|RatingType|Flags|Tag)\(/;
const METADATA_OTHER = /\.description\b|getDescription|getBitmap|getRating|getText\(|keySet|\.size\(\)/;
// Every way to declare a name `MUSIC_APP`: a val, var or const, a parameter, a lambda or loop
// variable, an import alias. Exactly one may exist, the constant, so no member shadows it.
const MUSIC_APP_DECLARED =
  /\b(?:val|var|const)\b[^=\n]*\bMUSIC_APP\b|\bMUSIC_APP\s*(?::|=(?!=)|->)|\bas\s+MUSIC_APP\b|\bfor\s*\(\s*MUSIC_APP\b/g;
// The only members the reader may name (after `.`, `?.` or `::`, string literals and the package
// and import lines left out): listing and filtering the sessions, the track's four keys, the play
// state and position, and the three transport commands. Anything else (`queue`, `playbackInfo`,
// `extras`, `seekTo`, `setVolumeTo`, …) is a read or a command the reader does not need.
const READER_MEMBERS = [
  "METADATA_KEY_ARTIST", "METADATA_KEY_DURATION", "METADATA_KEY_MEDIA_ID", "METADATA_KEY_TITLE",
  "NEXT", "PAUSE", "PLAY", "STATE_PLAYING", "class", "filter", "getActiveSessions", "getLong", "getString", "getSystemService", "java", "lastPositionUpdateTime",
  "let", "map", "metadata", "orEmpty", "packageName", "pause", "play", "playbackState", "position", "skipToNext",
  "state", "takeIf", "transportControls",
];
// Calls that bring an object's members into scope, so they could be named without a dot.
const IMPLICIT_RECEIVER = /\bwith\s*\(|\.(?:run|apply|also)\b|\bthis\b/;
// A receiver type does the same: a function type with a receiver (`T.() -> R`), an extension
// function or an extension property (`fun T.f()`, `val T.p`).
const RECEIVER_TYPE =
  /[\w>?)]\s*\.\s*\(|\bfun\s+(?:<[^>]*>\s*)?[\w.?<>]+\.\w+\s*\(|\b(?:val|var)\s+(?:<[^>]*>\s*)?[\w?<>]+\.\w+/;
// Every name the reader's code may contain, as kotlinNames gives them (comments and string text
// left out, template expressions kept): an allowlist over every way to reach a member, with or
// without a dot, so a new name of any kind (a member, a local, a parameter) fails until it is
// added here on purpose.
const READER_NAMES = [
  "AndroidSessions", "Boolean", "ComponentName", "Context", "ControllerSession", "FollowListener", "List",
  "METADATA_KEY_ARTIST", "METADATA_KEY_DURATION", "METADATA_KEY_MEDIA_ID", "METADATA_KEY_TITLE", "MUSIC_APP",
  "MediaController", "MediaMetadata", "MediaSessionManager", "NEXT", "PAUSE", "PLAY", "PlaybackState", "STATE_PLAYING",
  "SecurityException", "Session", "SessionState", "SessionTrack", "Sessions", "String", "TransportCommand", "active",
  "android", "app", "artist", "catch", "class", "classbeat", "command", "const", "content", "context", "controller",
  "controls", "e", "exists", "filter", "follow", "fun", "getActiveSessions", "getLong", "getString", "getSystemService",
  "id", "import", "it", "java", "lastPositionUpdateTime", "lengthMs", "let", "listener", "manager", "map", "media",
  "metadata", "ms", "null", "orEmpty", "org", "override", "package", "packageName", "pause", "play", "playbackState",
  "player", "position", "private", "send", "session", "skipToNext", "state", "takeIf", "title", "track",
  "transportControls", "try", "val", "when",
];
// The three places `MUSIC_APP` may appear, and nowhere else: the constant, the app it names and the filter.
const MUSIC_APP_USES = [
  /^private const val MUSIC_APP = ""$/m,
  /^ {4}override val app: String = MUSIC_APP$/m,
  /\?\.filter \{ it\.packageName == MUSIC_APP \}/,
];

/** The members the reader's code names, from kotlinCode's output; see READER_MEMBERS. */
function readerMembers(k: string): string[] {
  const body = k.replace(/^\s*(?:package|import)\b.*$/gm, "");
  const names = [...body.matchAll(/(?:\?\.|\.|::)\s*([A-Za-z_]\w*)/g)].map((m) => m[1]!);
  return [...new Set(names)].sort();
}

/** The problems in the session reader's source, one line each; empty when its rules hold. */
function readerProblems(text: string): string[] {
  // Every check runs on what the compiler sees (kotlinCode: comments and string text out, string
  // templates in), so neither a comment marker in a string nor code in a template hides anything.
  // `code()` is naive about strings (a "//" cuts the rest of its line) and keeps only the original
  // value pin and declaration count, each repeated on the lexer's output. The four checks that read
  // `code()` before #858 also read it and the strings' contents (kotlinSource, #859), so none sees less.
  const c = code(text);
  const k = kotlinCode(text);
  const views = [c, k, kotlinSource(text)];
  const literals: string[] = [];
  const kl = kotlinCode(text, literals);
  const names = kotlinNames(text);
  const found: string[] = [];
  const filteredIn = (v: string) => [...v.matchAll(SESSION_FILTERED)];
  for (const v of views) {
    const listed = [...v.matchAll(/getActiveSessions/g)].length;
    if (listed === 0 || filteredIn(v).length !== listed) found.push("a session list without the package filter");
  }
  if (!/^private const val MUSIC_APP = "com\.spotify\.music"$/m.test(c)) found.push("the package is not the constant");
  const pinned = [...kl.matchAll(/^private const val MUSIC_APP = "#(\d+)"$/gm)];
  if (pinned.length !== 1 || literals[Number(pinned[0]![1])] !== "com.spotify.music") found.push("the package is not the constant");
  if ([...c.matchAll(MUSIC_APP_DECLARED)].length !== 1 || [...k.matchAll(MUSIC_APP_DECLARED)].length !== 1)
    found.push("the package is not the constant");
  if (names.filter((n) => n === "MUSIC_APP").length !== MUSIC_APP_USES.length || !MUSIC_APP_USES.every((u) => u.test(k)))
    found.push("the package is not the constant");
  const allowed = ["METADATA_KEY_ARTIST", "METADATA_KEY_DURATION", "METADATA_KEY_MEDIA_ID", "METADATA_KEY_TITLE"];
  for (const v of views) {
    if (SESSION_OTHER_WAYS.test(v)) found.push("another way to a session");
    // Each view's first read, against that view's first filter.
    const firstRead = v.search(SESSION_READ);
    const first = filteredIn(v)[0];
    if (firstRead >= 0 && (first === undefined || firstRead < first.index!)) found.push("a read before the filter");
    const keys = [...new Set([...v.matchAll(/METADATA_KEY_\w+/g)].map((m) => m[0]))];
    if (keys.some((key) => !allowed.includes(key)) || METADATA_OTHER.test(v)) found.push("metadata beyond the track's identity");
  }
  const extra = readerMembers(k).filter((m) => !READER_MEMBERS.includes(m));
  if (extra.length > 0 || IMPLICIT_RECEIVER.test(k) || RECEIVER_TYPE.test(k))
    found.push("a member beyond the track, the state and the position");
  if (names.some((n) => !READER_NAMES.includes(n))) found.push("a name the reader does not use");
  return [...new Set(found)];
}

test("the session reader filters to the music app before any read, and reads only the track, the state and the position", () => {
  const file = ktFile(SESSION_READER);
  assert.deepEqual(readerProblems(file.text), []);
  // Each rule can fail.
  const filter = "?.filter { it.packageName == MUSIC_APP }";
  assert.ok(file.text.includes(filter));
  const F = "manager?.getActiveSessions(listener)?.filter { it.packageName == MUSIC_APP }?.map { ControllerSession(it) }";
  assert.ok(file.text.includes(F));
  const mutations: [string, string, string][] = [
    [filter, "", "a session list without the package filter"],
    [filter, "?.filter { it.packageName != MUSIC_APP }", "a session list without the package filter"],
    [filter, "?.filter { it.metadata != null && it.packageName == MUSIC_APP }", "a session list without the package filter"],
    ["override fun active()", "fun all() = manager?.getActiveSessions(listener)\n    override fun active()", "a session list without the package filter"],
    ["override fun active()", "fun peek() = manager?.getActiveSessions(listener)?.map { it.metadata }\n    override fun active()", "a session list without the package filter"],
    ["override fun active()", "fun peek(c: MediaController) = c.metadata\n    override fun active()", "a read before the filter"],
    ['MUSIC_APP = "com.spotify.music"', 'MUSIC_APP = "com.other.music"', "the package is not the constant"],
    ["override fun active()", "fun more() = manager?.addOnActiveSessionsChangedListener({ }, listener)\n    override fun active()", "another way to a session"],
    ["override fun active()", "fun make(t: MediaSession.Token) = MediaController(c, t)\n    override fun active()", "another way to a session"],
    ["METADATA_KEY_TITLE", "METADATA_KEY_ALBUM_ART", "metadata beyond the track's identity"],
    ["it.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)", "it.description.mediaId", "metadata beyond the track's identity"],
    // A member shadowing the constant, in either class (#856).
    ["override val app: String = MUSIC_APP", 'private val MUSIC_APP = "com.other.music"\n    override val app: String = MUSIC_APP', "the package is not the constant"],
    ["override val app: String = controller.packageName", 'private val MUSIC_APP: String = "com.other.music"\n    override val app: String = controller.packageName', "the package is not the constant"],
    ["class AndroidSessions(context: Context)", "class AndroidSessions(context: Context, MUSIC_APP: String = \"\")", "the package is not the constant"],
    // Reads after the filter and transport beyond play, pause and next (#856).
    ...["queue", "playbackInfo", "extras", "queueTitle", "sessionActivity", "ratingType"].map(
      (m): [string, string, string] => ["controller.metadata?.let", `controller.${m}.let { }\n        controller.metadata?.let`, "a member beyond the track, the state and the position"],
    ),
    ...["seekTo(0)", "setVolumeTo(0, 0)", "rewind()", "fastForward()", "stop()", "skipToPrevious()", "playFromMediaId(\"x\", null)", "setPlaybackSpeed(2f)"].map(
      (m): [string, string, string] => ["TransportCommand.NEXT -> controls.skipToNext()", `TransportCommand.NEXT -> controls.${m}`, "a member beyond the track, the state and the position"],
    ),
    ["controller.playbackState?.let {", "controller.playbackState?.let { controller.adjustVolume(1, 0)", "a member beyond the track, the state and the position"],
    ["controller.playbackState?.let {", "controller.playbackState?.let { val q = controller::getQueue", "a member beyond the track, the state and the position"],
    ["controller.playbackState?.let {", "with(controller) { queue }; controller.playbackState?.let {", "a member beyond the track, the state and the position"],
    ["controller.playbackState?.let {", "controller.run { queue }; controller.playbackState?.let {", "a member beyond the track, the state and the position"],
    // Review of #858: a destructured or multi-parameter shadow, members inside string templates,
    // members named without a dot through a receiver type, and code a string hides from `code`.
    [F, `("com.other.music" to 0).let { (MUSIC_APP, _) -> ${F} }`, "the package is not the constant"],
    [F, `listOf("com.other.music").fold(0) { MUSIC_APP, _ -> 0 }.let { ${F} }`, "the package is not the constant"],
    ["override fun exists()", 'fun f() { for ((MUSIC_APP, v) in listOf("a" to 1)) { } }\n    override fun exists()', "the package is not the constant"],
    ["override fun exists()", 'fun f() = "${MUSIC_APP}"\n    override fun exists()', "the package is not the constant"],
    ["TransportCommand.PAUSE -> controls.pause()", 'TransportCommand.PAUSE -> "${controls.seekTo(0)}"', "a member beyond the track, the state and the position"],
    ["override fun state()", 'fun q() = "${controller.queue}"\n    override fun state()', "a member beyond the track, the state and the position"],
    ["override fun state()", 'fun q() = """x${controller.extras}"""\n    override fun state()', "a member beyond the track, the state and the position"],
    ["override fun state()", 'fun q() = "$controller"\n    override fun state()', "a name the reader does not use"],
    ["override fun state()", "private val q: MediaController.() -> Any? = { queue }\n    fun peek() = q(controller)\n    override fun state()", "a member beyond the track, the state and the position"],
    ["override fun state()", "private fun MediaController.state() = queue\n    fun peek() = controller.state()\n    override fun state()", "a member beyond the track, the state and the position"],
    ["override fun state()", "private val MediaController.q get() = queue\n    override fun state()", "a member beyond the track, the state and the position"],
    ["override fun state()", "private fun MediaController.state() = metadata\n    override fun state()", "a member beyond the track, the state and the position"],
    ["override fun state()", "private fun MediaController.state() = queue\n    override fun state()", "a name the reader does not use"],
    ["TransportCommand.PAUSE -> controls.pause()", "TransportCommand.PAUSE -> controls.play { seekTo(0) }", "a name the reader does not use"],
    ["override fun state()", 'val s = "//"; fun q() = controller.queue\n    override fun state()', "a member beyond the track, the state and the position"],
    ["override fun state()", 'val s = "/*"; fun q() = controller.queue /* */\n    override fun state()', "a name the reader does not use"],
    ["override fun state()", "fun q() = controller.`queue`\n    override fun state()", "a member beyond the track, the state and the position"],
    // Review of #858, round 2: a "//" or "/*" in a string must not hide code from any reader check.
    [F, `${F}?.takeIf { "//" == "" } ?: manager?.getActiveSessions(listener)?.map { ControllerSession(it) }`, "a session list without the package filter"],
    [F, `${F}?.takeIf { "/*" == "*/" } ?: manager?.getActiveSessions(listener)?.map { ControllerSession(it) }`, "a session list without the package filter"],
    ["controller.metadata?.let {", 'controller.metadata?.takeIf { "//" == "" }?.let { it.getString(MediaMetadata.METADATA_KEY_ALBUM) }\n        controller.metadata?.let {', "metadata beyond the track's identity"],
    ["controller.metadata?.let {", 'controller.metadata?.takeIf { "//" == "" }?.let { it.description }\n        controller.metadata?.let {', "metadata beyond the track's identity"],
    [F, `${F}?.takeIf { "//" == "" } ?: manager?.getActiveSessions(listener)?.map { ControllerSession(MediaController(context, it.sessionToken)) }`, "another way to a session"],
    [F, `manager?.takeIf { "//" == "" }?.let { it.getActiveSessions(listener)?.map { s -> s.metadata } }.let { ${F} }`, "a read before the filter"],
    // Issue #859: a "//" in a string hides no declaration of the constant, and the four checks that
    // read `code()` before #858 still read the strings' contents.
    ["override fun exists()", 'val s = "//"; private val MUSIC_APP = "com.other.music"\n    override fun exists()', "the package is not the constant"],
    ["override fun exists()", 'val s = "getActiveSessions(listener)"\n    override fun exists()', "a session list without the package filter"],
    ["override fun exists()", 'val s = "MediaSession.Token"\n    override fun exists()', "another way to a session"],
    ["override fun exists()", 'val s = "controller.queue"\n    override fun exists()', "a read before the filter"],
    ["override fun exists()", 'val s = "METADATA_KEY_ALBUM"\n    override fun exists()', "metadata beyond the track's identity"],
    // Any letters make a name, and a backticked template reference is a name.
    ["override fun state()", "fun q() = listOf(1).map { é -> é }\n    override fun state()", "a name the reader does not use"],
    ["override fun state()", 'fun q() = "$`controller`"\n    override fun state()', "a name the reader does not use"],
  ];
  for (const [from, to, problem] of mutations) {
    const mutated = file.text.replace(from, to);
    assert.notEqual(mutated, file.text, from);
    assert.ok(readerProblems(mutated).includes(problem), `${to}: ${readerProblems(mutated).join("; ")}`);
  }
});

const namesSession = (_path: string, text: string, views: Views = ktViews): boolean => views(text).some((v) => SESSION_NAMES.test(v));

test("only the session reader names the media-session types and calls", () => {
  const naming = mobileKt.filter((s) => namesSession(s.path, s.text)).map((s) => s.path);
  assert.deepEqual(naming, [SESSION_READER]);
  for (const bad of ["c.transportControls.play()", "val s: PlaybackState? = x", "m.getActiveSessions(l)", "val t = c.metadata", "c.getPlaybackState()", "MediaMetadata.METADATA_KEY_TITLE"]) {
    assert.ok(namesSession("x.kt", bad), bad);
  }
});

const LISTENER = join(...KT_FOLLOW, "FollowListener.kt");
const EMPTY = /^package org\.classbeat\.player\.follow\s+import android\.service\.notification\.NotificationListenerService\s+class FollowListener : NotificationListenerService\(\)$/;
const READS = /getActiveNotifications|activeNotifications/;
// The listener is empty only when every view of it is.
const listenerNotEmpty = (_path: string, text: string, views: Views = ktViews): boolean => views(text).some((v) => !EMPTY.test(v.trim()));
const readsNotifications = (_path: string, text: string, views: Views = ktViews): boolean => views(text).some((v) => READS.test(v));

test("the notification listener stays empty and no Kotlin asks for the active notifications", () => {
  const listener = ktFile(LISTENER);
  assert.ok(!listenerNotEmpty(LISTENER, listener.text));
  assert.deepEqual(mobileKt.filter((s) => readsNotifications(s.path, s.text)).map((s) => s.path), []);
  // Both can fail.
  const body = listener.text.replace("NotificationListenerService()", "NotificationListenerService() {\n    override fun onListenerConnected() {}\n}");
  assert.notEqual(body, listener.text);
  assert.ok(listenerNotEmpty(LISTENER, body));
  for (const bad of ["getActiveNotifications()", "val n = activeNotifications"]) assert.ok(readsNotifications("x.kt", bad), bad);
});

// Issue #859: each check above catches code that a "//" in a string on the same line hides from `code`.
const W = "val webView = bridge.webView";
const FOLLOW = "fun followAccess()";
const FOLLOW_MUTATIONS: readonly KtMutation[] = [
  ["the media-session names", MAIN_ACTIVITY, W, `${W}; val s = "//"; c.transportControls.play()`, true],
  ["the media-session names", join(...KT_FOLLOW, "Follower.kt"), FOLLOW, `val s = "//"; val p = c.playbackState\n    ${FOLLOW}`, true],
  ["the active notifications", MAIN_ACTIVITY, W, `${W}; val s = "//"; val n = activeNotifications`, true],
  // `code` cuts the line but leaves `val s = "` in the class, so it sees this one too.
  ["the empty listener", LISTENER, "NotificationListenerService()", 'NotificationListenerService() { override fun onListenerConnected() { val s = "//" } }', false],
];

test("the follow checks catch code a string's \"//\" hides on the same line", () => {
  const checks = new Map([
    ["the media-session names", namesSession],
    ["the active notifications", readsNotifications],
    ["the empty listener", listenerNotEmpty],
  ]);
  assert.deepEqual(mutationGaps(FOLLOW_MUTATIONS, checks), []);
  assert.deepEqual([...new Set(FOLLOW_MUTATIONS.map(([c]) => c))].sort(), [...checks.keys()].sort());
});

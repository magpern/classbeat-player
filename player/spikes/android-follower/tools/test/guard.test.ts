// The hard limits of issue #554, checked on the real sources and, by mutation, shown to bite.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkTree, stripComments } from "../src/guard_rules.js";
import type { Tree } from "../src/guard_rules.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const SKIP = new Set(["build", "node_modules", ".gradle", ".git"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function load(): Tree {
  const paths = walk(root).map((p) => relative(root, p).split("\\").join("/"));
  const files: Record<string, string> = {};
  for (const p of paths) {
    const wanted = p === "app/src/main/AndroidManifest.xml" || (p.endsWith(".kt") && p.includes("/src/main/")) || p.endsWith(".kts");
    if (wanted) files[p] = readFileSync(join(root, p), "utf8");
  }
  return { files, paths };
}

const real = load();

function mutate(path: string, from: string | RegExp, to: string): Tree {
  const text = real.files[path];
  assert.ok(text !== undefined, `${path} is not in the tree`);
  const next = text.replace(from, to);
  assert.notEqual(next, text, `mutation of ${path} changed nothing`);
  return { ...real, files: { ...real.files, [path]: next } };
}

/** Several edits in a row on app/build.gradle.kts. */
function gradle(...edits: [from: string, to: string][]): Tree {
  let text = real.files["app/build.gradle.kts"]!;
  for (const [from, to] of edits) {
    const next = text.replace(from, () => to);
    assert.notEqual(next, text, `edit of the build script changed nothing: ${from}`);
    text = next;
  }
  return { ...real, files: { ...real.files, "app/build.gradle.kts": text } };
}

const MANIFEST ="app/src/main/AndroidManifest.xml";
const LISTENER = "app/src/main/kotlin/org/classbeat/spike/follower/SpikeListener.kt";
const READER = "app/src/main/kotlin/org/classbeat/spike/follower/SpotifyReader.kt";
const FOLLOW = "app/src/main/kotlin/org/classbeat/spike/follower/FollowSession.kt";
const SCENE = "app/src/main/kotlin/org/classbeat/spike/follower/SceneActivity.kt";
const CORE = "core/src/main/kotlin/org/classbeat/spike/SpotifyFilter.kt";
const APP_GRADLE = "app/build.gradle.kts";
const perm = (name: string) => mutate(MANIFEST, "<application", `<uses-permission android:name="android.permission.${name}" />\n    <application`);

describe("the real sources", () => {
  it("find the files the checks depend on", () => {
    for (const p of [MANIFEST, LISTENER, READER, SCENE, CORE, APP_GRADLE]) assert.ok(real.files[p], p);
  });

  it("break none of the hard limits", () => {
    assert.deepEqual(checkTree(real), []);
  });

  it("have no permission at all in the source manifest", () => {
    assert.doesNotMatch(real.files[MANIFEST]!.replace(/<!--[\s\S]*?-->/g, ""), /<uses-permission/);
  });
});

const mutations: [name: string, rule: string, tree: () => Tree][] = [
  ["INTERNET permission", "permission", () => perm("INTERNET")],
  ["CAMERA permission", "permission", () => perm("CAMERA")],
  ["RECORD_AUDIO permission", "permission", () => perm("RECORD_AUDIO")],
  ["fine location permission", "permission", () => perm("ACCESS_FINE_LOCATION")],
  ["coarse location permission", "permission", () => perm("ACCESS_COARSE_LOCATION")],
  ["a Bluetooth permission", "permission", () => perm("BLUETOOTH_CONNECT")],
  ["a Bluetooth class", "bluetooth", () => mutate(READER, "class SpotifyReader", "val adapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter()\nclass SpotifyReader")],
  ["a listener callback that does something", "listener", () => mutate(LISTENER, "onNotificationPosted(sbn: StatusBarNotification?) {}", "onNotificationPosted(sbn: StatusBarNotification?) { println(sbn) }")],
  ["a listener that lists notifications", "notifications", () => mutate(LISTENER, "onNotificationRemoved(sbn: StatusBarNotification?) {}", "onNotificationRemoved(sbn: StatusBarNotification?) { getActiveNotifications() }")],
  ["a notification's contents read elsewhere", "notifications", () => mutate(READER, "class SpotifyReader", "fun peek(s: android.service.notification.StatusBarNotification) = s.notification.extras\nclass SpotifyReader")],
  ["a second notification listener", "listener", () => mutate(READER, "class SpotifyReader", "class Other : android.service.notification.NotificationListenerService()\nclass SpotifyReader")],
  ["a listener declared without the bind permission", "listener", () => mutate(MANIFEST, /android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/, "")],
  ["sessions not filtered to Spotify", "filter", () => mutate(READER, "spotifyOnly(sessions) { it.packageName }.firstOrNull()", "sessions.firstOrNull()")],
  ["metadata read before the filter", "filter", () => mutate(READER, "manager.getActiveSessions(listener)", "manager.getActiveSessions(listener).also { it.firstOrNull()?.metadata }")],
  // #559 N1: any read of the session list other than spotifyOnly(list) { it.packageName }.
  ["a fallback to an unfiltered session", "filter", () => mutate(READER, "?: return Poll(polledAt, null, null)", "?: sessions.first()")],
  ["a package lambda that returns a constant", "filter", () => mutate(READER, "spotifyOnly(sessions) { it.packageName }", 'spotifyOnly(sessions) { "com.spotify.music" }')],
  ["the session list read through another path", "filter", () => mutate(READER, "val metadata = spotify.metadata", "val metadata = sessions.last().metadata")],
  // Review of #561, B1: one getActiveSessions in the whole tree, no other source of the session list.
  ["M1: a second, unassigned getActiveSessions read", "filter", () => mutate(READER, "val spotify = spotifyOnly", "val other = manager.getActiveSessions(listener).first().metadata\n        val spotify = spotifyOnly")],
  ["M2: addOnActiveSessionsChangedListener in another file", "filter", () => mutate(FOLLOW, "class FollowSession", "fun peek(m: android.media.session.MediaSessionManager, c: android.content.ComponentName) = m.addOnActiveSessionsChangedListener({ l -> l?.first()?.metadata }, c)\nclass FollowSession")],
  ["a second getActiveSessions in another file", "filter", () => mutate(FOLLOW, "class FollowSession", "fun peek(m: Any) = m.getActiveSessions()\nclass FollowSession")],
  ["getActiveSessionsForUser", "filter", () => mutate(READER, "class SpotifyReader", "fun f(m: Any) = m.getActiveSessionsForUser()\nclass SpotifyReader")],
  ["a MediaController", "filter", () => mutate(READER, "class SpotifyReader", "fun f(t: Any) = MediaController(t)\nclass SpotifyReader")],
  ["MediaSessionManager outside SpotifyReader.kt", "filter", () => mutate(FOLLOW, "class FollowSession", "val m: android.media.session.MediaSessionManager? = null\nclass FollowSession")],
  // Review of #561, B2: every blockNetworkLoads is exactly `= true` ending its statement.
  ["M3: blockNetworkLoads = true && flag", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = true && flag")],
  ["blockNetworkLoads = true.and(flag)", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = true.and(flag)")],
  ["blockNetworkLoads = true on a continued line", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = true\n            || flag")],
  // Review of #561, NB1, NB2, NB5.
  ["reflection: Class.forName", "reflection", () => mutate(READER, "class SpotifyReader", 'val c = Class.forName("x")\nclass SpotifyReader')],
  ["reflection: ::class.java.getMethod", "reflection", () => mutate(READER, "class SpotifyReader", 'val c = String::class.java.getMethod("x")\nclass SpotifyReader')],
  ["reflection: java.lang.reflect", "reflection", () => mutate(READER, "class SpotifyReader", "import java.lang.reflect.Method\nclass SpotifyReader")],
  ["ToneGenerator", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.ToneGenerator::class\nclass SpotifyReader")],
  ["AsyncPlayer", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.AsyncPlayer::class\nclass SpotifyReader")],
  ["JetPlayer", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.JetPlayer::class\nclass SpotifyReader")],
  ["a .java file", "sources", () => ({ ...real, paths: [...real.paths, "app/src/main/kotlin/org/classbeat/spike/follower/Evil.java"] })],
  ["a .java file under src/main/java", "sources", () => ({ ...real, paths: [...real.paths, "app/src/main/java/Evil.java"] })],
  ["a .kt in another source set", "sources", () => ({ ...real, paths: [...real.paths, "app/src/debug/kotlin/Evil.kt"] })],
  ["a .kt under src/main/java", "sources", () => ({ ...real, paths: [...real.paths, "app/src/main/java/Evil.kt"] })],
  ["another build script", "sources", () => ({ ...real, paths: [...real.paths, "extra/build.gradle.kts"] })],
  // #559 N2: any assignment of blockNetworkLoads other than true.
  ["a second blockNetworkLoads = false", "webview", () => mutate(SCENE, "web.webViewClient =", "web.settings.blockNetworkLoads = false\n        web.webViewClient =")],
  ["setBlockNetworkLoads(false)", "webview", () => mutate(SCENE, "web.webViewClient =", "web.settings.setBlockNetworkLoads(false)\n        web.webViewClient =")],
  ["blockNetworkLoads set from a variable", "webview", () => mutate(SCENE, "web.webViewClient =", "web.settings.blockNetworkLoads = flag\n        web.webViewClient =")],
  // #559 N3: the listener's body is the two empty callbacks and nothing else.
  ["an init block in the listener", "listener", () => mutate(LISTENER, "NotificationListenerService() {", 'NotificationListenerService() {\n    init { println("x") }')],
  ["a field initializer in the listener", "listener", () => mutate(LISTENER, "NotificationListenerService() {", "NotificationListenerService() {\n    val seen = ArrayList<Any>()")],
  ["an expression-bodied property in the listener", "listener", () => mutate(LISTENER, "NotificationListenerService() {", "NotificationListenerService() {\n    override val activeNotifications get() = emptyArray<StatusBarNotification>()")],
  ["a top-level initializer beside the listener", "listener", () => mutate(LISTENER, "/**", 'val boot = println("x")\n\n/**')],
  // #559 N4: audio and codec classes that rule 3 forbids.
  ["MediaCodec", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.MediaCodec::class\nclass SpotifyReader")],
  ["MediaExtractor", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.MediaExtractor()\nclass SpotifyReader")],
  ["SoundPool", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.SoundPool::class\nclass SpotifyReader")],
  ["MediaRecorder", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.MediaRecorder::class\nclass SpotifyReader")],
  ["Visualizer", "audio", () => mutate(READER, "class SpotifyReader", "val c = android.media.audiofx.Visualizer::class\nclass SpotifyReader")],
  // #559 N5: a char literal holding a quote must not hide real code behind a fake string.
  ["a network class after a quote char literal", "network", () => mutate(READER, "class SpotifyReader", "val q = '\"'\nval u = java.net.URL(\"x\")\nclass SpotifyReader")],
  // #559 N6: the manifest check runs on every build and install path.
  ["the manifest check not wired to install", "manifest", () => mutate(APP_GRADLE, '"install$cap", ', "")],
  ["the manifest check not wired to package", "manifest", () => mutate(APP_GRADLE, '"package$cap", ', "")],
  ["a transport command", "transport", () => mutate(READER, "val metadata = spotify.metadata", "spotify.transportControls.pause()\n        val metadata = spotify.metadata")],
  ["a media key", "transport", () => mutate(READER, "class SpotifyReader", "val key = android.view.KeyEvent.KEYCODE_MEDIA_NEXT\nclass SpotifyReader")],
  ["MediaPlayer", "audio", () => mutate(READER, "class SpotifyReader", "val p = android.media.MediaPlayer()\nclass SpotifyReader")],
  ["ExoPlayer", "audio", () => mutate(READER, "class SpotifyReader", "import androidx.media3.exoplayer.ExoPlayer\nclass SpotifyReader")],
  ["AudioTrack", "audio", () => mutate(READER, "class SpotifyReader", "val t = android.media.AudioTrack::class\nclass SpotifyReader")],
  ["AudioRecord", "audio", () => mutate(READER, "class SpotifyReader", "val r = android.media.AudioRecord::class\nclass SpotifyReader")],
  ["a Spotify SDK", "audio", () => mutate(READER, "class SpotifyReader", "import com.spotify.android.appremote.api.SpotifyAppRemote\nclass SpotifyReader")],
  ["a media3 dependency", "dependencies", () => mutate(APP_GRADLE, 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    implementation("androidx.media3:media3-exoplayer:1.4.1")')],
  ["a dependency off the allowlist", "dependencies", () => mutate(APP_GRADLE, 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    implementation("com.example:thing:1.0")')],
  ["a changed dependency version", "dependencies", () => mutate(APP_GRADLE, "webkit:1.12.1", "webkit:+")],
  ["a network class", "network", () => mutate(READER, "class SpotifyReader", "val u = java.net.URL(\"x\")\nclass SpotifyReader")],
  ["an HTTP client", "network", () => mutate(READER, "class SpotifyReader", "import okhttp3.OkHttpClient\nclass SpotifyReader")],
  ["a URL that is not the bundled origin", "network", () => mutate(SCENE, "https://appassets.androidplatform.net/assets/scene/", "https://example.com/assets/scene/")],
  ["a JavaScript bridge", "network", () => mutate(SCENE, "web.webViewClient =", 'web.addJavascriptInterface(Object(), "x")\n        web.webViewClient =')],
  ["a web view that may load from the network", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = false")],
  ["cleartext traffic", "network", () => mutate(MANIFEST, 'usesCleartextTraffic="false"', 'usesCleartextTraffic="true"')],
  ["a credential name", "secrets", () => mutate(READER, "class SpotifyReader", "val access_token = 1\nclass SpotifyReader")],
  ["a signing config", "signing", () => mutate(APP_GRADLE, "android {", 'android {\n    signingConfigs { create("x") { storeFile = file("x.jks") } }')],
  ["a release build type", "signing", () => mutate(APP_GRADLE, "android {", "android {\n    buildTypes { getByName(\"release\") { isMinifyEnabled = true } }")],
  ["a committed keystore", "signing", () => ({ ...real, paths: [...real.paths, "app/debug.keystore"] })],
  ["a committed env file", "signing", () => ({ ...real, paths: [...real.paths, ".env"] })],
  ["Android code in the pure core", "core", () => mutate(CORE, "package org.classbeat.spike", "package org.classbeat.spike\n\nimport android.os.Build")],
  ["no manifest check in the build", "manifest", () => mutate(APP_GRADLE, /CheckManifest/g, "Nothing")],
  // #565 NB-B: reflection by property.
  ["NB-B: javaClass bound to a variable, methods and invoke", "reflection", () => mutate(READER, "class SpotifyReader", 'val k = manager.javaClass\nval r = k.methods.first { it.name == "getActive" + "Sessions" }.invoke(manager, null)\nclass SpotifyReader')],
  ["NB-B: bare javaClass", "reflection", () => mutate(READER, "class SpotifyReader", "val k = this.javaClass\nclass SpotifyReader")],
  ["NB-B: ::class.java bound to a variable", "reflection", () => mutate(READER, "class SpotifyReader", "val k = String::class.java\nclass SpotifyReader")],
  ["NB-B: .invoke(", "reflection", () => mutate(READER, "class SpotifyReader", "val r = f.invoke(1)\nclass SpotifyReader")],
  ["NB-B: methods", "reflection", () => mutate(READER, "class SpotifyReader", "val r = k.methods\nclass SpotifyReader")],
  ["NB-B: declaredMethods", "reflection", () => mutate(READER, "class SpotifyReader", "val r = k.declaredMethods\nclass SpotifyReader")],
  ["NB-B: fields", "reflection", () => mutate(READER, "class SpotifyReader", "val r = k.fields\nclass SpotifyReader")],
  ["NB-B: declaredFields", "reflection", () => mutate(READER, "class SpotifyReader", "val r = k.declaredFields\nclass SpotifyReader")],
  ["NB-B: constructors", "reflection", () => mutate(READER, "class SpotifyReader", "val r = k.constructors\nclass SpotifyReader")],
  // #565 NB-A: a line after `blockNetworkLoads = true` that starts with `?.` (or an operator or keyword) continues it.
  ["NB-A: blockNetworkLoads = true then ?.", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = true\n            ?.let { flag }")],
  ["NB-A: blockNetworkLoads = true then as", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = true\n            as Boolean")],
  ["NB-A: blockNetworkLoads = true then ?:", "webview", () => mutate(SCENE, "blockNetworkLoads = true", "blockNetworkLoads = true\n            ?: flag")],
  // #565 NB3: a nested "/*" inside a template must not hide code.
  ["NB3: a nested \"/*\" in a template hides a network class", "network", () => mutate(READER, "class SpotifyReader", 'val a = "${"/*"}"\nval u = java.net.URL("x")\nval b = "*/"\nclass SpotifyReader')],
  // #565 NB4: a task name elsewhere in the file is not the list passed to dependsOn.
  ["NB4: install$cap named elsewhere, not in the list", "manifest", () => mutate(APP_GRADLE, '"install$cap", "assemble$cap")', '"assemble$cap")\n        val unused = listOf("install$cap")')],
  ["NB4: the list is not the one dependsOn uses", "manifest", () => mutate(APP_GRADLE, "it.name in guarded", "it.name in emptyList<String>()")],
  ["NB4: dependsOn something other than the check", "manifest", () => mutate(APP_GRADLE, "dependsOn(check) }", "dependsOn(syncSceneAssets) }")],
  // #565 NB-C: version catalogs hide coordinates from the allowlist.
  ["NB-C: a libs.* dependency", "dependencies", () => mutate(APP_GRADLE, 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    implementation(libs.thing)')],
  ["NB-C: a version catalog file", "dependencies", () => ({ ...real, paths: [...real.paths, "gradle/libs.versions.toml"] })],
  ["NB-C: a catalog declared in settings", "dependencies", () => mutate("settings.gradle.kts", /^/, 'dependencyResolutionManagement { versionCatalogs { create("x") { from(files("a.toml")) } } }\n')],
  // Review of #566, B1: compiling routes from a class object to a method by name (fixture compiled by the reviewer).
  ["B1: the reviewer's compiling reflection routes", "reflection", () => mutate(READER, "class SpotifyReader", `${readFileSync(new URL("fixtures/reflection_routes.kt.txt", import.meta.url), "utf8")}\nclass SpotifyReader`)],
  ["B1: Class<*>::getMethod callable reference", "reflection", () => mutate(READER, "class SpotifyReader", "val find = Class<*>::getMethod\nclass SpotifyReader")],
  ["B1: getMethod with a space before the parenthesis", "reflection", () => mutate(READER, "class SpotifyReader", 'fun peek(c: Class<*>) = c.getMethod ("x")\nclass SpotifyReader')],
  ["B1: ::class without .java", "reflection", () => mutate(READER, "class SpotifyReader", "val k = MediaSessionManager::class\nclass SpotifyReader")],
  ["B1: a class object bound through listOf", "reflection", () => mutate(READER, "class SpotifyReader", "val c = listOf(MediaSessionManager::class.java).first()\nclass SpotifyReader")],
  ["B1: newInstance", "reflection", () => mutate(READER, "class SpotifyReader", "fun <T> make(c: Class<T>) = c.newInstance()\nclass SpotifyReader")],
  ["B1: a class object as a plain call argument", "reflection", () => mutate(READER, "class SpotifyReader", "val c = peek(String::class.java)\nclass SpotifyReader")],
  ["B1: a reflection name in a comment", "reflection", () => mutate(READER, "class SpotifyReader", "// getDeclaredMethod\nclass SpotifyReader")],
  // Review of #566, B2: names fail in comments and strings too; a crafted string or comment cannot hide code.
  ["B2: a raw string closed by a run of quotes hides code", "network", () => mutate(READER, "class SpotifyReader", 'val a = """x""""\nval b = "/*"\nval u = java.net.URL("x")\nval c = "*/"\nclass SpotifyReader')],
  ["B2: a nested block comment hides code", "network", () => mutate(READER, "class SpotifyReader", '/* /* */ " */\nval b = "/*"\nval u = java.net.URL("x")\nval c = "*/"\nclass SpotifyReader')],
  ["B2: a network class named in a comment", "network", () => mutate(READER, "class SpotifyReader", "// java.net.URL\nclass SpotifyReader")],
  ["B2: an audio class named in a string", "audio", () => mutate(READER, "class SpotifyReader", 'val s = "MediaPlayer"\nclass SpotifyReader')],
  // Review of #566 round 2: a backtick identifier holding a quote desyncs the stripper (fixture Tick.kt).
  ["Q1: a backtick quote hides blockNetworkLoads = false", "webview", () => mutate(SCENE, "blockNetworkLoads = true", 'blockNetworkLoads = true\n        val `q"` = 0\n        val b = "/*"\n        web.settings.blockNetworkLoads = false\n        val c = "*/"')],
  ["Q1: the same, caught as a backtick", "syntax", () => mutate(SCENE, "blockNetworkLoads = true", 'blockNetworkLoads = true\n        val `q"` = 0\n        val b = "/*"\n        web.settings.blockNetworkLoads = false\n        val c = "*/"')],
  ["Q2: a backtick quote hides a second, unfiltered session read", "filter", () => mutate(READER, "class SpotifyReader", 'val `q"` = 0\nval b = "/*"\nfun x(m: MediaSessionManager, l: ComponentName) = m.getActiveSessions(l).first().metadata\nval c = "*/"\nclass SpotifyReader')],
  ["Q3: a backtick quote hides an off-list dependency", "dependencies", () => mutate(APP_GRADLE, 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    val `q"` = 0\n    val b = "/*"\n    implementation("com.evil:lib:1.0")\n    val c = "*/"')],
  ["Q3: the same, caught as a backtick", "syntax", () => mutate(APP_GRADLE, 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    val `q"` = 0\n    val b = "/*"\n    implementation("com.evil:lib:1.0")\n    val c = "*/"')],
  ["a backtick identifier", "syntax", () => mutate(READER, "class SpotifyReader", "val `x` = 1\nclass SpotifyReader")],
  ["a comment token inside a string", "syntax", () => mutate(READER, "class SpotifyReader", 'val s = "/*"\nclass SpotifyReader')],
  ["a second getActiveSessions in a block comment", "filter", () => mutate(READER, "class SpotifyReader", "/* getActiveSessions */\nclass SpotifyReader")],
  ["a commented-out off-list dependency", "dependencies", () => mutate(APP_GRADLE, 'implementation("androidx.webkit:webkit:1.12.1")', 'implementation("androidx.webkit:webkit:1.12.1")\n    /* implementation("com.evil:lib:1.0") */')],
  ["a release block in a block comment", "signing", () => mutate(APP_GRADLE, "android {", "android {\n    /* release */")],
  ["NB-1 Q4: :: class with spaces", "reflection", () => mutate(READER, "class SpotifyReader", "val k = MediaSessionManager :: class\nclass SpotifyReader")],
  ["NB-1 Q5: a shadowing Intent function", "reflection", () => mutate(READER, "class SpotifyReader", "fun Intent(a: Any, c: Class<*>) = c\nclass SpotifyReader")],
  ["NB-1 Q6: enclosingMethod", "reflection", () => mutate(READER, "class SpotifyReader", "val m = c.enclosingMethod\nclass SpotifyReader")],
  // Review of #566, B3: the wiring list is one bare listOf, declared once.
  ["B3: .filter { false } on the guarded list", "manifest", () => mutate(APP_GRADLE, '"assemble$cap")', '"assemble$cap").filter { false }')],
  ["B3: a decoy list declared earlier, real list without install", "manifest", () => gradle(['"install$cap", "assemble$cap")', '"assemble$cap")'], ["    onVariants { variant ->", '    val guarded = listOf("compile${cap}Kotlin", "install$cap")\n    onVariants { variant ->'])],
  ["B3: a second wiring statement", "manifest", () => mutate(APP_GRADLE, "tasks.matching { it.name in guarded }", "tasks.matching { it.name in guarded }.configureEach { dependsOn(check) }\n        tasks.matching { it.name in guarded }")],
  // #567 NB-B: the manifest check task cannot be switched off.
  ["NB-B: check.configure { enabled = false }", "manifest", () => mutate(APP_GRADLE, "        tasks.matching { it.name in guarded }", "        check.configure { enabled = false }\n        tasks.matching { it.name in guarded }")],
  ["NB-B: check.configure { onlyIf { false } }", "manifest", () => mutate(APP_GRADLE, "        tasks.matching { it.name in guarded }", "        check.configure { onlyIf { false } }\n        tasks.matching { it.name in guarded }")],
  // #567 NB-A: other declaration kinds that shadow Intent, ComponentName or getSystemService.
  ["NB-A: class Intent", "reflection", () => mutate(READER, "class SpotifyReader", "class Intent(a: Any, val c: Class<*>)\nclass SpotifyReader")],
  ["NB-A: object ComponentName", "reflection", () => mutate(READER, "class SpotifyReader", "object ComponentName\nclass SpotifyReader")],
  ["NB-A: typealias Intent", "reflection", () => mutate(READER, "class SpotifyReader", "typealias Intent = Pair<Any, Class<*>>\nclass SpotifyReader")],
  ["NB-A: import alias named getSystemService", "reflection", () => mutate(READER, "class SpotifyReader", "import a.b.c as getSystemService\nclass SpotifyReader")],
  ["NB-A: interface ComponentName", "reflection", () => mutate(READER, "class SpotifyReader", "interface ComponentName\nclass SpotifyReader")],
  // #567 NB-C: the checks that read only the stripped text run on the second view too (a block comment
  // is gone from the stripped text but still in the raw text minus `//` lines).
  ["NB-C: StatusBarNotification outside the listener, in a block comment", "notifications", () => mutate(READER, "class SpotifyReader", "/* StatusBarNotification */\nclass SpotifyReader")],
  ["NB-C: a second listener in a block comment", "listener", () => mutate(READER, "class SpotifyReader", "/* class Other : NotificationListenerService() */\nclass SpotifyReader")],
  ["NB-C: a non-empty listener function in a block comment", "listener", () => mutate(LISTENER, "NotificationListenerService() {", "NotificationListenerService() {\n    /* fun x() { 1 } */")],
  ["NB-C: a second wiring statement in a block comment", "manifest", () => mutate(APP_GRADLE, "        tasks.matching { it.name in guarded }", "        /* tasks.matching { it.name in guarded }.configureEach { dependsOn(check) } */\n        tasks.matching { it.name in guarded }")],
];

describe("each hard limit fails when broken", () => {
  for (const [name, rule, tree] of mutations) {
    it(name, () => {
      const found = checkTree(tree());
      assert.ok(found.some((x) => x.startsWith(`${rule}:`)), `expected a "${rule}" violation, got ${JSON.stringify(found)}`);
    });
  }
});

describe("stripComments", () => {
  it("handles a char literal holding a quote, so later strings and comments are read right", () => {
    const out = stripComments("val q = '\"' // gone INTERNET\nval s = \"a // kept\"\nval t = MediaCodec");
    assert.match(out, /a \/\/ kept/);
    assert.match(out, /MediaCodec/);
    assert.doesNotMatch(out, /gone|INTERNET/);
  });

  it("keeps escaped char literals whole", () => {
    assert.match(stripComments("val a = '\\'' /* x */ val b = '\\u0041'"), /'\\''\s+val b = '\\u0041'/);
  });

  it("reads a `${...}` template as code, so a nested \"/*\" does not open a comment", () => {
    const out = stripComments('val a = "x ${"/*"} y"\nval u = MediaCodec\nval b = "*/"');
    assert.match(out, /MediaCodec/);
  });

  it("strips a comment inside a template and handles nested braces and raw strings", () => {
    const out = stripComments('val a = "${ mapOf(1 to {2}) /* gone */ }"\nval r = """${"/*"} raw"""\nval u = MediaCodec');
    assert.doesNotMatch(out, /gone/);
    assert.match(out, /MediaCodec/);
  });

  it("closes a raw string at the last quote of a run, so what follows is code again", () => {
    const out = stripComments('val a = """x""""\nval b = "/*"\nval u = MediaCodec\nval c = "*/"');
    assert.match(out, /MediaCodec/);
  });

  it("nests block comments", () => {
    const out = stripComments('/* a /* b */ still comment MediaPlayer */ val u = MediaCodec\nval s = "/*"\nval v = AudioTrack\nval t = "*/"');
    assert.doesNotMatch(out, /MediaPlayer|still/);
    assert.match(out, /MediaCodec/);
    assert.match(out, /AudioTrack/);
  });

  it("drops comments and keeps a URL inside a string", () => {
    const out = stripComments('val a = "https://x.y/z" // note about INTERNET\n/* MediaPlayer */ val b = 1');
    assert.match(out, /https:\/\/x\.y\/z/);
    assert.doesNotMatch(out, /INTERNET|MediaPlayer|note/);
  });
});

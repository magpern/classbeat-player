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

const MANIFEST = "app/src/main/AndroidManifest.xml";
const LISTENER = "app/src/main/kotlin/org/classbeat/spike/follower/SpikeListener.kt";
const READER = "app/src/main/kotlin/org/classbeat/spike/follower/SpotifyReader.kt";
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
  it("drops comments and keeps a URL inside a string", () => {
    const out = stripComments('val a = "https://x.y/z" // note about INTERNET\n/* MediaPlayer */ val b = 1');
    assert.match(out, /https:\/\/x\.y\/z/);
    assert.doesNotMatch(out, /INTERNET|MediaPlayer|note/);
  });
});

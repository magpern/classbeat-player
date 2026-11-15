// Source guard for spike 3's hard limits (issue #554; ADR 0011 sections 6 and 8). Pure: it takes
// the file texts and returns violations, so a test can run it on the real tree and on a mutated copy.
// Where a list can be closed it is an allowlist (permissions, dependencies, URLs), not a blocklist.

export interface Tree {
  /** Paths relative to android-follower/, mapped to their text: manifest, `.kt` under src/main, `.kts`. */
  files: Record<string, string>;
  /** Every path in the tree (for committed signing material). */
  paths: string[];
}

import { countMatches, stripComments, stripXmlComments } from "./kotlin_text.js";
import { listenerShapeProblem, networkLoadsProblem, sessionsProblem } from "./kotlin_shape.js";
import { reflectionProblem } from "./reflection_rules.js";
import { catalogProblem, gradleWiringProblems } from "./gradle_rules.js";

export { stripComments };

const READER = "/SpotifyReader.kt";
/** Other ways to get the unfiltered session list: never used here. */
const SESSION_SOURCES = /addOnActiveSessionsChangedListener|getActiveSessionsForUser|\bMediaController\b/;
const KT_PATHS = /^(?:app\/src\/main|core\/src\/main|core\/src\/test)\/kotlin\/.+\.kt$/;
const KTS_PATHS = /^(?:|app\/|core\/)(?:build|settings)\.gradle\.kts$/;
const CODE_FILE = /\.(?:java|kt|kts|groovy|gradle|scala|aidl|c|cc|cpp|h|rs|dex|jar|aar|so)$/i;

const AUDIO =/\b(?:MediaCodec\w*|MediaExtractor|MediaMuxer|Ringtone\w*|playSoundEffect|MediaPlayer|ExoPlayer|AudioTrack|AudioRecord|MediaRecorder|SoundPool|AudioPlaybackCapture\w*|MediaProjection\w*|AudioEffect|Visualizer|TextToSpeech|ToneGenerator|AsyncPlayer|JetPlayer)\b|androidx\.media3|androidx\.media\.|com\.spotify\.(?!music")/;
const TRANSPORT = /transportControls|TransportControls|dispatchMediaButtonEvent|dispatchMediaKeyEvent|KEYCODE_MEDIA|sendCommand|sendCustomAction|playFromMediaId|playFromUri|adjustVolume|setVolumeTo|MediaBrowser|MediaButtonReceiver/;
const NOTIFICATION_READ = /getActiveNotifications|activeNotifications|\.notification\b|\.extras\b|tickerText|EXTRA_TITLE|EXTRA_TEXT|EXTRA_BIG_TEXT|snoozeNotification|cancelNotification|currentRanking|getCurrentRanking/;
const BLUETOOTH = /android\.bluetooth|Bluetooth\w*|BLUETOOTH/;
const NETWORK = /java\.net\.|javax\.net|okhttp|retrofit|android\.net\.(?!Uri\b)|HttpURLConnection|URLConnection|\bSocket\b|WebSocket|DownloadManager|ConnectivityManager|addJavascriptInterface|WebViewCompat\.addWebMessageListener/;
const SECRET = /\b(?:access[_-]?token|client[_-]?secret|api[_-]?key|password|authorization|bearer)\b/i;
const SIGNING = /signingConfig|storeFile|storePassword|keyPassword|keyAlias/;
const ALLOWED_DEPENDENCIES = ["androidx.core:core-ktx:1.15.0", "androidx.webkit:webkit:1.12.1"];
/** The Gradle tasks (as written in app/build.gradle.kts) that must depend on the merged-manifest check. */
const GUARDED_TASKS = ["compile${cap}Kotlin", "compile${cap}JavaWithJavac", "package$cap", "package${cap}Bundle", "bundle$cap", "install$cap", "assemble$cap"];
const ALLOWED_URL = "https://appassets.androidplatform.net/";

export function checkTree(tree: Tree): string[] {
  const v: string[] = [];
  const add = (rule: string, path: string, what: string) => v.push(`${rule}: ${path}: ${what}`);
  const kt = Object.entries(tree.files).filter(([p]) => p.endsWith(".kt")).map(([p, t]) => [p, stripComments(t)] as const);
  const kts = Object.entries(tree.files).filter(([p]) => p.endsWith(".kts")).map(([p, t]) => [p, stripComments(t)] as const);
  const manifestPath = "app/src/main/AndroidManifest.xml";
  const manifest = stripXmlComments(tree.files[manifestPath] ?? "");
  if (!tree.files[manifestPath]) add("manifest", manifestPath, "missing");

  // No permission of any kind (this covers INTERNET, CAMERA, RECORD_AUDIO, location and Bluetooth).
  for (const m of manifest.matchAll(/<uses-permission[\w-]*\b[^>]*android:name="([^"]+)"/g)) add("permission", manifestPath, `asks for ${m[1]}`);
  if (/<uses-feature[^>]*bluetooth/i.test(manifest)) add("bluetooth", manifestPath, "uses a Bluetooth feature");
  if (/usesCleartextTraffic="true"/.test(manifest)) add("network", manifestPath, "allows cleartext traffic");
  const service = manifest.match(/<service\b[^>]*SpikeListener[^>]*>/);
  if (!service || !/android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/.test(service[0])) add("listener", manifestPath, "SpikeListener must be declared with the BIND_NOTIFICATION_LISTENER_SERVICE permission");

  // The notification listener is empty, and the only one.
  const listeners = kt.filter(([, t]) => /\bNotificationListenerService\b/.test(t));
  if (listeners.length !== 1 || !listeners[0]![0].endsWith("/SpikeListener.kt")) add("listener", "app", "exactly one listener, SpikeListener.kt, may exist");
  for (const [p, t] of listeners) {
    const shape = listenerShapeProblem(t);
    if (shape) add("listener", p, shape);
    const funs = [...t.matchAll(/\bfun\s+\w+/g)].length;
    const empty = [...t.matchAll(/\bfun\s+\w+\s*\([^)]*\)\s*(?::\s*[\w.?]+)?\s*\{\s*\}/g)].length;
    if (funs !== empty) add("listener", p, "every function of the notification listener must have an empty body");
    if (funs === 0) add("listener", p, "no callbacks found: the check cannot see the listener");
  }
  // Name lists run on the stripped text and on the raw text: a name inside a comment or string fails too,
  // so a parser slip can only cause a false positive, never hide code.
  const both = (re: RegExp, t: string, raw: string) => re.test(t) || re.test(raw);
  for (const [p, t] of kt) {
    // Imports are left out: `android.service.notification.X` is a package, not a read.
    const noImports = (x: string) => x.replace(/^\s*(?:import|package)\s.*$/gm, "");
    if (both(NOTIFICATION_READ, noImports(t), noImports(tree.files[p]!))) add("notifications", p, "reads notifications");
    if (!p.endsWith("/SpikeListener.kt") && /StatusBarNotification/.test(t)) add("notifications", p, "touches StatusBarNotification outside the listener");
  }

  for (const [p, t] of kt) {
    const raw = tree.files[p]!;
    if (both(TRANSPORT, t, raw)) add("transport", p, "sends or can send a transport command");
    if (both(AUDIO, t, raw)) add("audio", p, "uses an audio player, recorder or Spotify SDK");
    if (both(BLUETOOTH, t, raw)) add("bluetooth", p, "uses Bluetooth");
    if (both(NETWORK, t, raw)) add("network", p, "uses a network class or a JavaScript bridge");
    if (both(SECRET, t, raw)) add("secrets", p, "names a credential");
    for (const m of raw.matchAll(/https?:\/\/[^"\s)]*/g)) if (!m[0].startsWith(ALLOWED_URL)) add("network", p, `URL ${m[0]}`);
    if (/allowFileAccess\s*=\s*true|setAllowFileAccess\(\s*true|AllowUniversalAccessFromFileURLs/.test(t)) add("webview", p, "opens file access");
    if (p.endsWith("/SceneActivity.kt") && !/blockNetworkLoads\s*=\s*true/.test(t)) add("webview", p, "the web view must set blockNetworkLoads = true");
    const loads = networkLoadsProblem(t);
    if (loads) add("webview", p, loads);
    const reflection = reflectionProblem(t) ?? reflectionProblem(raw);
    if (reflection) add("reflection", p, reflection);
    if (both(SESSION_SOURCES, t, raw)) add("filter", p, "uses a source of the unfiltered session list other than getActiveSessions");
    if (!p.endsWith(READER) && both(/\bMediaSessionManager\b/, t, raw)) add("filter", p, "MediaSessionManager is allowed only in SpotifyReader.kt");
  }
  // Source files come from an allowlist of paths: no .java, no other source set, no other build script.
  for (const p of tree.paths) {
    if (p.startsWith("tools/") || !CODE_FILE.test(p)) continue;
    const ok = p.endsWith(".kt") ? KT_PATHS.test(p) : p.endsWith(".kts") ? KTS_PATHS.test(p) : p === "gradle/wrapper/gradle-wrapper.jar";
    if (!ok) add("sources", p, "a source or binary file outside the allowlisted paths");
  }
  for (const p of tree.paths) if (/\.(?:jks|keystore|p12|pfx)$|(?:^|\/)(?:keystore\.properties|\.env[\w.]*)$/i.test(p)) add("signing", p, "committed signing material or env file");

  // Reads Spotify's session only: filtered to Spotify's package before anything is read.
  // getActiveSessions occurs exactly once in the whole tree (occurrences, not files), in SpotifyReader.kt.
  const readers = kt.filter(([, t]) => /\bgetActiveSessions\b/.test(t));
  const calls = kt.reduce((n, [, t]) => n + countMatches(t, /\bgetActiveSessions\b/g), 0);
  if (calls !== 1 || readers.length !== 1 || !readers[0]![0].endsWith(READER)) add("filter", "app", `getActiveSessions must occur exactly once, in SpotifyReader.kt (found ${calls})`);
  for (const [p, t] of readers) {
    const used = sessionsProblem(t);
    if (used) add("filter", p, used);
    const from = t.indexOf("getActiveSessions");
    const filter = t.indexOf("spotifyOnly(", from);
    const firstRead = Math.min(...[".metadata", ".playbackState", "getMetadata", "getPlaybackState"].map((k) => { const i = t.indexOf(k, from); return i < 0 ? Infinity : i; }));
    if (filter < 0) add("filter", p, "the active sessions are not filtered with spotifyOnly");
    else if (filter > firstRead) add("filter", p, "metadata or state is read before the Spotify filter");
  }

  // The build: pinned dependencies from an allowlist, debug signing only, the manifest check in place.
  for (const [p, t] of kts) {
    const raw = tree.files[p]!;
    if (both(SIGNING, t, raw)) add("signing", p, "defines signing");
    // The build scripts' own comments name `release` and Spotify, so these two stay on the stripped text.
    if (/\brelease\b/.test(t)) add("signing", p, "defines or names a release build");
    if (/spotify|media3|exoplayer|bluetooth|okhttp|retrofit|firebase/i.test(t)) add("dependencies", p, "names a forbidden library");
    if (both(SECRET, t, raw)) add("secrets", p, "names a credential");
    for (const m of t.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp|testImplementation|androidTestImplementation)\(\s*"([^"]+)"\s*\)/g)) {
      if (p.startsWith("app/") && !ALLOWED_DEPENDENCIES.includes(m[1]!)) add("dependencies", p, `dependency ${m[1]} is not on the allowlist`);
    }
    for (const m of t.matchAll(/https?:\/\/[^"\s)]*/g)) add("network", p, `URL ${m[0]}`);
    const catalog = catalogProblem(t);
    if (catalog) add("dependencies", p, catalog);
  }
  for (const p of tree.paths) if (/\.toml$/i.test(p) && !p.startsWith("tools/")) add("dependencies", p, "a version catalog file is not allowed");
  const app = kts.find(([p]) => p === "app/build.gradle.kts");
  if (!app || !/CheckManifest/.test(app[1]) || !/MERGED_MANIFEST/.test(app[1])) add("manifest", "app/build.gradle.kts", "the merged-manifest check is missing");

  // The check is wired to every path to a built or installed app, not only `assemble` (#559, N6).
  if (app) for (const what of gradleWiringProblems(app[1], GUARDED_TASKS)) add("manifest", "app/build.gradle.kts", what);

  // The pure module imports no Android class and no I/O.
  for (const [p, t] of kt) {
    if (p.startsWith("core/") && /^\s*import\s+(?:android\.|java\.io|java\.nio|java\.net|javax\.)/m.test(t)) add("core", p, "the pure core imports Android or I/O");
  }
  return v;
}

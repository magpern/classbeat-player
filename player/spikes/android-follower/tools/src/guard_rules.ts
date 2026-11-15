// Source guard for spike 3's hard limits (issue #554; ADR 0011 sections 6 and 8). Pure: it takes
// the file texts and returns violations, so a test can run it on the real tree and on a mutated copy.
// Where a list can be closed it is an allowlist (permissions, dependencies, URLs), not a blocklist.

export interface Tree {
  /** Paths relative to android-follower/, mapped to their text: manifest, `.kt` under src/main, `.kts`. */
  files: Record<string, string>;
  /** Every path in the tree (for committed signing material). */
  paths: string[];
  /** SHA-256 (hex) of the binary build inputs by path (the wrapper jar). Computed by the loader, not here. */
  hashes?: Record<string, string>;
}

import { countMatches, liteText, stripComments, stripXmlComments, syntaxProblem } from "./kotlin_text.js";
import { listenerShapeProblem, networkLoadsProblem, readerOrderProblem, sessionsProblem } from "./kotlin_shape.js";
import { useSiteProblem } from "./use_sites.js";
import { reflectionProblem } from "./reflection_rules.js";
import { buildScriptProblems } from "./gradle_shape.js";
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
  const isListener = (p: string, t: string) => [t, liteText(tree.files[p]!)].some((x) => /\bNotificationListenerService\b/.test(x));
  const listeners = kt.filter(([p, t]) => isListener(p, t));
  if (listeners.length !== 1 || !listeners[0]![0].endsWith("/SpikeListener.kt")) add("listener", "app", "exactly one listener, SpikeListener.kt, may exist");
  for (const [p, t] of listeners) {
    // The second view also drops block comments (the doc comment), with a plain non-nesting pattern.
    const shape = [t, liteText(tree.files[p]!).replace(/\/\*[\s\S]*?\*\//g, " ")].map(listenerShapeProblem).find(Boolean);
    if (shape) add("listener", p, shape);
    // The two-views rule: the stripped text and the raw text minus `//` lines must both say the same.
    for (const x of [t, liteText(tree.files[p]!)]) {
      const funs = [...x.matchAll(/\bfun\s+\w+/g)].length;
      const empty = [...x.matchAll(/\bfun\s+\w+\s*\([^)]*\)\s*(?::\s*[\w.?]+)?\s*\{\s*\}/g)].length;
      if (funs !== empty) { add("listener", p, "every function of the notification listener must have an empty body"); break; }
      if (funs === 0) { add("listener", p, "no callbacks found: the check cannot see the listener"); break; }
    }
  }
  // Name lists run on the stripped text and on the raw text: a name inside a comment or string fails too,
  // so a parser slip can only cause a false positive, never hide code.
  const both = (re: RegExp, t: string, raw: string) => re.test(t) || re.test(raw);
  for (const [p, t] of kt) {
    // Imports are left out: `android.service.notification.X` is a package, not a read.
    const noImports = (x: string) => x.replace(/^\s*(?:import|package)\s.*$/gm, "");
    if (both(NOTIFICATION_READ, noImports(t), noImports(tree.files[p]!))) add("notifications", p, "reads notifications");
    if (!p.endsWith("/SpikeListener.kt") && [t, liteText(tree.files[p]!)].some((x) => /StatusBarNotification/.test(x))) add("notifications", p, "touches StatusBarNotification outside the listener");
  }

  for (const [p, t] of kt) {
    const raw = tree.files[p]!;
    if (both(TRANSPORT, t, raw)) add("transport", p, "sends or can send a transport command");
    if (both(AUDIO, t, raw)) add("audio", p, "uses an audio player, recorder or Spotify SDK");
    if (both(BLUETOOTH, t, raw)) add("bluetooth", p, "uses Bluetooth");
    if (both(NETWORK, t, raw)) add("network", p, "uses a network class or a JavaScript bridge");
    if (both(SECRET, t, raw)) add("secrets", p, "names a credential");
    for (const m of raw.matchAll(/https?:\/\/[^"\s)]*/g)) if (!m[0].startsWith(ALLOWED_URL)) add("network", p, `URL ${m[0]}`);
    const views = [t, liteText(raw)];
    if (syntaxProblem(t)) add("syntax", p, syntaxProblem(t)!);
    if (views.some((x) => /allowFileAccess\s*=\s*true|setAllowFileAccess\(\s*true|AllowUniversalAccessFromFileURLs/.test(x))) add("webview", p, "opens file access");
    if (p.endsWith("/SceneActivity.kt") && !views.every((x) => /blockNetworkLoads\s*=\s*true/.test(x))) add("webview", p, "the web view must set blockNetworkLoads = true");
    const loads = views.map(networkLoadsProblem).find(Boolean);
    if (loads) add("webview", p, loads);
    const reflection = reflectionProblem(t) ?? reflectionProblem(raw);
    // Intent, ComponentName and getSystemService only in the pinned statements, on both views.
    const useSite = useSiteProblem(p, [t, liteText(raw)]);
    if (useSite) add("reflection", p, useSite);
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
  // Counted on the stripped text and on the raw text minus `//` lines: both must say once.
  const SESSIONS = /\bgetActiveSessions\b/g;
  const viewsOf = (p: string, t: string) => [t, liteText(tree.files[p]!)];
  const readers = kt.filter(([p, t]) => viewsOf(p, t).some((x) => countMatches(x, SESSIONS) > 0));
  const calls = [0, 1].map((i) => kt.reduce((n, [p, t]) => n + countMatches(viewsOf(p, t)[i]!, SESSIONS), 0));
  if (calls.some((n) => n !== 1) || readers.length !== 1 || !readers[0]![0].endsWith(READER)) add("filter", "app", `getActiveSessions must occur exactly once, in SpotifyReader.kt (found ${calls.join(" and ")})`);
  for (const [p, t] of readers) {
    // The shape checks read identifiers, so the second view also drops block comments (their prose names the list), with a plain non-nesting pattern that does not track strings.
    for (const x of [t, liteText(tree.files[p]!).replace(/\/\*[\s\S]*?\*\//g, " ")]) {
      const used = sessionsProblem(x) ?? readerOrderProblem(x);
      if (used) { add("filter", p, used); break; }
    }
  }

  // The build: pinned dependencies from an allowlist, debug signing only, the manifest check in place.
  for (const [p, t] of kts) {
    const raw = tree.files[p]!;
    if (both(SIGNING, t, raw)) add("signing", p, "defines signing");
    // Every code rule runs on the stripped text and on the raw text minus whole-line `//` comments.
    const views = [t, liteText(raw)];
    if (syntaxProblem(t)) add("syntax", p, syntaxProblem(t)!);
    if (views.some((x) => /\brelease\b/.test(x))) add("signing", p, "defines or names a release build");
    if (views.some((x) => /spotify|media3|exoplayer|bluetooth|okhttp|retrofit|firebase/i.test(x))) add("dependencies", p, "names a forbidden library");
    if (both(SECRET, t, raw)) add("secrets", p, "names a credential");
    for (const x of views) {
      for (const m of x.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp|testImplementation|androidTestImplementation)\(\s*"([^"]+)"\s*\)/g)) {
        if (p.startsWith("app/") && !ALLOWED_DEPENDENCIES.includes(m[1]!)) add("dependencies", p, `dependency ${m[1]} is not on the allowlist`);
      }
      for (const m of x.matchAll(/https?:\/\/[^"\s)]*/g)) add("network", p, `URL ${m[0]}`);
    }
    const catalog = views.map(catalogProblem).find(Boolean);
    if (catalog) add("dependencies", p, catalog);
  }
  for (const p of tree.paths) if (/\.toml$/i.test(p) && !p.startsWith("tools/")) add("dependencies", p, "a version catalog file is not allowed");
  // Every build script equals its pinned text (the real guard); extra scripts and included builds fail.
  for (const [rule, path, what] of buildScriptProblems(tree.files, tree.paths, tree.hashes ?? {})) add(rule, path, what);
  const app = kts.find(([p]) => p === "app/build.gradle.kts");
  if (!app || !/CheckManifest/.test(app[1]) || !/MERGED_MANIFEST/.test(app[1])) add("manifest", "app/build.gradle.kts", "the merged-manifest check is missing");

  // The check is wired to every path to a built or installed app, not only `assemble` (#559, N6).
  if (app) {
    const wiring = [app[1], liteText(tree.files[app[0]]!)].flatMap((x) => gradleWiringProblems(x, GUARDED_TASKS));
    for (const what of new Set(wiring)) add("manifest", "app/build.gradle.kts", what);
  }

  // The pure module imports no Android class and no I/O.
  for (const [p, t] of kt) {
    if (p.startsWith("core/") && [t, liteText(tree.files[p]!)].some((x) => /^\s*import\s+(?:android\.|java\.io|java\.nio|java\.net|javax\.)/m.test(x))) add("core", p, "the pure core imports Android or I/O");
  }
  return v;
}

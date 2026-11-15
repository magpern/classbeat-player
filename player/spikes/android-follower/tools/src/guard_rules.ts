// Source guard for spike 3's hard limits (issue #554; ADR 0011 sections 6 and 8). Pure: it takes
// the file texts and returns violations, so a test can run it on the real tree and on a mutated copy.
// Where a list can be closed it is an allowlist (permissions, dependencies, URLs), not a blocklist.

export interface Tree {
  /** Paths relative to android-follower/, mapped to their text: manifest, `.kt` under src/main, `.kts`. */
  files: Record<string, string>;
  /** Every path in the tree (for committed signing material). */
  paths: string[];
}

/** A Kotlin char literal: 'x', '"', '\n', '\'' or 'A'. */
const CHAR_LITERAL = /^'(?:\\u[0-9a-fA-F]{4}|\\.|[^\\'\n])'/;

/** Removes comments but keeps string and char literals (so a `//` inside "https://..." survives). */
export function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    const chr = c === "'" ? CHAR_LITERAL.exec(src.slice(i, i + 8)) : null;
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const stop = end < 0 ? src.length : end + 3;
      out += src.slice(i, stop);
      i = stop;
    } else if (chr) {
      // Kept whole, so a quote inside it (`'"'`) does not open a string.
      out += chr[0];
      i += chr[0].length;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const stripXmlComments = (x: string) => x.replace(/<!--[\s\S]*?-->/g, "");

const AUDIO = /\b(?:MediaCodec\w*|MediaExtractor|MediaMuxer|Ringtone\w*|playSoundEffect|MediaPlayer|ExoPlayer|AudioTrack|AudioRecord|MediaRecorder|SoundPool|AudioPlaybackCapture\w*|MediaProjection\w*|AudioEffect|Visualizer|TextToSpeech)\b|androidx\.media3|androidx\.media\.|com\.spotify\.(?!music")/;
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

const CALLBACK = /override\s+fun\s+(?:onNotificationPosted|onNotificationRemoved)\s*\(\s*\w+\s*:\s*StatusBarNotification\??\s*\)\s*\{\s*\}/g;

/** The listener file is the class header and the two empty callbacks: no init block, field or other member (N3). */
function listenerShapeProblem(text: string): string | null {
  const t = text.replace(/^\s*(?:import|package)\s.*$/gm, "");
  const header = /class\s+SpikeListener\s*:\s*NotificationListenerService\(\)\s*\{/.exec(t);
  if (!header) return "SpikeListener must be `class SpikeListener : NotificationListenerService() {`";
  const start = header.index + header[0].length;
  let depth = 1;
  let end = start;
  for (; end < t.length && depth > 0; end++) depth += t[end] === "{" ? 1 : t[end] === "}" ? -1 : 0;
  if (depth !== 0) return "the listener's braces do not balance";
  const body = t.slice(start, end - 1).replace(CALLBACK, "");
  const outside = t.slice(0, header.index) + t.slice(end);
  if (body.trim() !== "" || outside.trim() !== "") return "the listener may hold only the two empty callbacks (no init block, field or other member)";
  return null;
}

/** The list from getActiveSessions may be used only as `spotifyOnly(list) { it.packageName }`, nothing else reads it (N1). */
function sessionsProblem(text: string): string | null {
  const decl = /\bval\s+(\w+)\s*=\s*(?:try\s*\{\s*)?\w+\.getActiveSessions\s*\([^)]*\)\s*(?:\}\s*catch\b|$)/m.exec(text);
  if (!decl) return "getActiveSessions must be assigned alone to a val (`val x = try { manager.getActiveSessions(c) } catch ...`)";
  const name = decl[1]!;
  const use = `spotifyOnly\\(\\s*${name}\\s*\\)\\s*\\{\\s*it\\.packageName\\s*\\}`;
  if (!new RegExp(use).test(text)) return `the session list ${name} is never filtered with spotifyOnly(${name}) { it.packageName }`;
  const rest = text.replace(decl[0], "").replace(new RegExp(use, "g"), "");
  if (new RegExp(`\\b${name}\\b`).test(rest)) return `the session list ${name} is read other than through spotifyOnly(${name}) { it.packageName }`;
  return null;
}

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
  for (const [p, t] of kt) {
    // Imports are left out: `android.service.notification.X` is a package, not a read.
    if (NOTIFICATION_READ.test(t.replace(/^\s*(?:import|package)\s.*$/gm, ""))) add("notifications", p, "reads notifications");
    if (!p.endsWith("/SpikeListener.kt") && /StatusBarNotification/.test(t)) add("notifications", p, "touches StatusBarNotification outside the listener");
  }

  for (const [p, t] of kt) {
    if (TRANSPORT.test(t)) add("transport", p, "sends or can send a transport command");
    if (AUDIO.test(t)) add("audio", p, "uses an audio player, recorder or Spotify SDK");
    if (BLUETOOTH.test(t)) add("bluetooth", p, "uses Bluetooth");
    if (NETWORK.test(t)) add("network", p, "uses a network class or a JavaScript bridge");
    if (SECRET.test(t)) add("secrets", p, "names a credential");
    for (const m of t.matchAll(/https?:\/\/[^"\s)]*/g)) if (!m[0].startsWith(ALLOWED_URL)) add("network", p, `URL ${m[0]}`);
    if (/allowFileAccess\s*=\s*true|setAllowFileAccess\(\s*true|AllowUniversalAccessFromFileURLs/.test(t)) add("webview", p, "opens file access");
    if (p.endsWith("/SceneActivity.kt") && !/blockNetworkLoads\s*=\s*true/.test(t)) add("webview", p, "the web view must set blockNetworkLoads = true");
    // Any other assignment of it, anywhere (property or setter form), is a violation.
    if (/blockNetworkLoads\s*=(?!=)(?!\s*true\b)|setBlockNetworkLoads\s*\((?!\s*true\s*\))/.test(t)) add("webview", p, "blockNetworkLoads may only ever be set to true");
  }
  for (const p of tree.paths) if (/\.(?:jks|keystore|p12|pfx)$|(?:^|\/)(?:keystore\.properties|\.env[\w.]*)$/i.test(p)) add("signing", p, "committed signing material or env file");

  // Reads Spotify's session only: filtered to Spotify's package before anything is read.
  const readers = kt.filter(([, t]) => t.includes("getActiveSessions"));
  if (readers.length !== 1) add("filter", "app", "exactly one file may call getActiveSessions");
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
    if (SIGNING.test(t)) add("signing", p, "defines signing");
    if (/\brelease\b/.test(t)) add("signing", p, "defines or names a release build");
    if (/spotify|media3|exoplayer|bluetooth|okhttp|retrofit|firebase/i.test(t)) add("dependencies", p, "names a forbidden library");
    if (SECRET.test(t)) add("secrets", p, "names a credential");
    for (const m of t.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|kapt|ksp|testImplementation|androidTestImplementation)\(\s*"([^"]+)"\s*\)/g)) {
      if (p.startsWith("app/") && !ALLOWED_DEPENDENCIES.includes(m[1]!)) add("dependencies", p, `dependency ${m[1]} is not on the allowlist`);
    }
    for (const m of t.matchAll(/https?:\/\/[^"\s)]*/g)) add("network", p, `URL ${m[0]}`);
  }
  const app = kts.find(([p]) => p === "app/build.gradle.kts");
  if (!app || !/CheckManifest/.test(app[1]) || !/MERGED_MANIFEST/.test(app[1])) add("manifest", "app/build.gradle.kts", "the merged-manifest check is missing");

  // The check is wired to every path to a built or installed app, not only `assemble` (#559, N6).
  if (app) {
    for (const task of GUARDED_TASKS) {
      if (!app[1].includes(`"${task}"`)) add("manifest", "app/build.gradle.kts", `the merged-manifest check is not wired to ${task}`);
    }
  }

  // The pure module imports no Android class and no I/O.
  for (const [p, t] of kt) {
    if (p.startsWith("core/") && /^\s*import\s+(?:android\.|java\.io|java\.nio|java\.net|javax\.)/m.test(t)) add("core", p, "the pure core imports Android or I/O");
  }
  return v;
}

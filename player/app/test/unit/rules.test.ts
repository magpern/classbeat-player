// Rule guards (plan section 3) and code structure rules (CLAUDE.md), checked on the source.
// Rule 2: no equipment control. Rule 3: no audio playback, no Spotify interface.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";

const SRC = join(REPO, "player", "app", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const sources = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
// Comments may name a rule; the guard looks at code only.
const code = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

const FORBIDDEN: readonly [string, RegExp][] = [
  ["audio playback (rule 3)", /\bnew\s+Audio\b|<audio\b|<video\b|\bAudioContext\b|\bwebkitAudioContext\b|\bMediaSource\b|\.play\(\)/],
  ["a Spotify interface (rule 3)", /spotify\.com|api\.spotify|sdk\.scdn|Spotify\.Player|spotify-web-api/i],
  ["equipment control (rule 2)", /\bwriteValue\w*\(|\bnavigator\.bluetooth\b|\bnavigator\.usb\b|\bnavigator\.serial\b|\bnavigator\.hid\b|\bresistance\b|\bincline\s*=|\bsetSpeed\b|\bbrake\b/i],
  ["a network request", /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|\bnet\.request\b|node:https?\b|require\(["']https?["']\)/],
];

// The one exception (owner, 2026-11-13, #173): the host's live connection to our own backend
// (ADR 0005 section 1) may name the runtime's `WebSocket` in main/live/live-socket.ts, and only
// there. It is taken out of the network check alone: audio, Spotify and equipment control stay
// fully enforced in that file, and every other file keeps the full network check.
const LIVE_SOCKET = join("main", "live", "live-socket.ts");
const LIVE_SETUP = join("main", "live", "setup.ts");
const NETWORK = "a network request";
const NETWORK_EXCEPTIONS: ReadonlyMap<string, RegExp> = new Map([[LIVE_SOCKET, /\bWebSocket\b/g]]);
// The second exception (ADR 0013 section 5, #693): the room window plays a Swedebeat mix, which
// plan rule 3 allows, through one `<audio>` element. Exactly that element in renderer/room.html and
// exactly its `audio.play()` in renderer/room-mix.ts are taken out of the audio check alone. Every
// other way to make sound stays a hit in those two files, and both words stay hits everywhere else.
const AUDIO = "audio playback (rule 3)";
const ROOM_HTML = join("renderer", "room.html");
const ROOM_MIX = join("renderer", "room-mix.ts");
const AUDIO_EXCEPTIONS: ReadonlyMap<string, RegExp> = new Map([
  [ROOM_HTML, /<audio id="mix" preload="auto"><\/audio>/g],
  [ROOM_MIX, /\baudio\.play\(\)/g],
]);
const checked = (path: string, text: string, what: string): string => {
  const strip = what === NETWORK ? NETWORK_EXCEPTIONS.get(path) : what === AUDIO ? AUDIO_EXCEPTIONS.get(path) : undefined;
  return strip ? text.replace(strip, "") : text;
};

for (const [what, re] of FORBIDDEN) {
  test(`no ${what} anywhere in the app's source`, () => {
    const hits = sources.filter((s) => re.test(checked(s.path, code(s.text), what))).map((s) => s.path);
    assert.deepEqual(hits, []);
  });
}

test("the live connection's exception is one file and one word, for the network check only", () => {
  assert.deepEqual([...NETWORK_EXCEPTIONS.keys()], [LIVE_SOCKET]);
  assert.deepEqual([...NETWORK_EXCEPTIONS.values()].map((r) => r.source), ["\\bWebSocket\\b"]);
  const live = sources.find((s) => s.path === LIVE_SOCKET);
  assert.ok(live, "the exception names a file that exists");
  assert.match(code(live.text), /\bWebSocket\b/);
  // In that file every other way onto the network is still a hit.
  for (const bad of ["fetch(u)", "new XMLHttpRequest()", "new EventSource(u)", "net.request(u)", 'import "node:https"', 'require("http")']) {
    assert.match(checked(LIVE_SOCKET, `new WebSocket(u); ${bad}`, NETWORK), FORBIDDEN[3][1], bad);
  }
  // The other rules take no exception there.
  const others: [string, string][] = [["audio playback (rule 3)", "new Audio(x)"], ["a Spotify interface (rule 3)", "api.spotify"], ["equipment control (rule 2)", "c.writeValue(b)"]];
  for (const [what, bad] of others) assert.match(checked(LIVE_SOCKET, `WebSocket ${bad}`, what), FORBIDDEN.find(([w]) => w === what)![1], what);
  // Any other file: the word is a network request.
  for (const path of [join("main", "main.ts"), LIVE_SETUP, join("main", "live", "live-service.ts"), join("renderer", "live-panel.ts")]) {
    assert.match(checked(path, "new WebSocket(u)", NETWORK), FORBIDDEN[3][1], path);
  }
});

test("the mix's exception is one element and one call, in two files, for the audio check only", () => {
  assert.deepEqual([...AUDIO_EXCEPTIONS.keys()], [ROOM_HTML, ROOM_MIX]);
  assert.deepEqual([...AUDIO_EXCEPTIONS.values()].map((r) => r.source), ['<audio id="mix" preload="auto"><\\/audio>', "\\baudio\\.play\\(\\)"]);
  for (const [path, re] of AUDIO_EXCEPTIONS) {
    const s = sources.find((x) => x.path === path);
    assert.ok(s, `${path} exists`);
    // Exactly one element and one call: the exception covers no second one.
    assert.equal(code(s.text).match(re)?.length, 1, path);
  }
  // In those files every other way to make sound is still a hit.
  for (const path of [ROOM_HTML, ROOM_MIX]) {
    for (const bad of ["new Audio(x)", "<audio src=x>", "<video>", "new AudioContext()", "webkitAudioContext", "new MediaSource()", "el.play()"]) {
      assert.match(checked(path, bad, AUDIO), FORBIDDEN[0][1], `${path}: ${bad}`);
    }
  }
  // The other rules take no exception there.
  for (const [what, bad] of [["a Spotify interface (rule 3)", "api.spotify"], ["equipment control (rule 2)", "c.writeValue(b)"], [NETWORK, "fetch(u)"]] as const) {
    assert.match(checked(ROOM_MIX, `audio.play() ${bad}`, what), FORBIDDEN.find(([w]) => w === what)![1], what);
  }
  // Any other file: both are audio playback.
  for (const path of [join("renderer", "room.ts"), join("renderer", "presenter.html"), join("main", "mix", "mix-player.ts"), join("scene", "x.ts")]) {
    assert.match(checked(path, '<audio id="mix" preload="auto"></audio>', AUDIO), FORBIDDEN[0][1], path);
    assert.match(checked(path, "audio.play()", AUDIO), FORBIDDEN[0][1], path);
  }
});

test("the live socket reaches only the backend's /api/live/ paths", () => {
  const text = code(sources.find((s) => s.path === LIVE_SOCKET)!.text);
  // It has no address of its own: no scheme or host, and any path is under /api/live/.
  const literals = [...text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
  for (const l of literals) {
    assert.doesNotMatch(l, /:\/\/|^wss?:|^https?:/i, l);
    if (l.includes("/")) assert.match(l, /^\/api\/live\//, l);
  }
  // The only address it is handed is the live socket's, built in core/live/host-wire.ts.
  const service = code(sources.find((s) => s.path === join("main", "live", "live-service.ts"))!.text);
  assert.deepEqual([...service.matchAll(/\bconnect\(([^,(]+)\(/g)].map((m) => m[1].trim()), ["liveSocketUrl"]);
  const wire = code(sources.find((s) => s.path === join("core", "live", "host-wire.ts"))!.text);
  assert.deepEqual([...wire.matchAll(/new URL\(("[^"]*")/g)].map((m) => JSON.parse(m[1])), ["/api/live/ws"]);
});

test("only main/live/setup.ts calls into the live socket", () => {
  const valueImport = /^import\s+(?!type\b)[^;]*from\s+["'][^"']*live-socket(?:\.ts)?["']/m;
  const importers = sources.filter((s) => valueImport.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(importers, [LIVE_SETUP]);
  const callers = sources.filter((s) => s.path !== LIVE_SOCKET && /\bwebSocketConnect\b/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(callers, [LIVE_SETUP]);
});

test("the guard itself catches what it looks for", () => {
  assert.match(code("const a = new Audio('x');"), FORBIDDEN[0][1]);
  assert.match(code("c.writeValueWithResponse(buf)"), FORBIDDEN[2][1]);
  assert.doesNotMatch(code("// new Audio() is never used"), FORBIDDEN[0][1]);
});

const IO = /from\s+["'](electron|node:fs|node:fs\/promises|fs|node:net|node:http|node:https|node:child_process|node:path|node:os|node:perf_hooks)["']|\b(window|document|process)\./;

test("the core is pure: no Electron, filesystem, network, process or DOM", () => {
  const hits = sources.filter((s) => s.path.startsWith("core") && IO.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(hits, []);
});

test("source files stay under about 300 lines (150 for the clock and link rule modules)", () => {
  for (const s of sources) {
    const lines = s.text.split("\n").length;
    const cap = s.path.startsWith(join("core", "clock")) || s.path.startsWith(join("core", "link")) ? 150 : 300;
    assert.ok(lines <= cap, `${s.path}: ${lines} lines`);
  }
});

test("nothing is imported from the spikes", () => {
  const hits = sources.filter((s) => /spikes?\//.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(hits, []);
});

// The phone shell (player/mobile, issue #627) is held to the same rules: its TypeScript to the
// list above, with no exception, and its Kotlin to the list below. Installed packages, build
// output and the bundled page (built from the sources checked here) are not sources. They are
// skipped by their exact paths, so a source folder that happens to be called "build" or "public"
// elsewhere is still checked.
const MOBILE = join(REPO, "player", "mobile");
const MOBILE_SKIP = new Set(
  ["node_modules", "android/.gradle", "android/.kotlin", "android/build", "android/app/build", "android/app/src/main/assets/public"].map((p) => join(...p.split("/"))),
);
function mobileFiles(dir: string, ext: RegExp, root = MOBILE): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return MOBILE_SKIP.has(relative(root, p)) ? [] : mobileFiles(p, ext, root);
    return ext.test(n) ? [p] : [];
  });
}
const mobileSource = (ext: RegExp) => mobileFiles(MOBILE, ext).map((p) => ({ path: relative(MOBILE, p), text: readFileSync(p, "utf8") }));
const mobileTs = mobileSource(/\.(ts|mjs|js|html)$/);
const mobileKt = mobileSource(/\.(kt|kts|java)$/);
const MANIFEST = join(MOBILE, "android", "app", "src", "main", "AndroidManifest.xml");

test("the phone shell has TypeScript and Kotlin sources to check", () => {
  assert.ok(mobileTs.some((s) => s.path === join("src", "main.ts")));
  assert.ok(mobileKt.some((s) => s.path.endsWith("BridgeLockdown.kt")));
  // Rider mode (issue #633): its page, its native session and transport, and its bridge.
  for (const ts of ["app.ts", "flow.ts", "link.ts", "native.ts", "numbers.ts", "pages.ts", "strip.ts"]) {
    assert.ok(mobileTs.some((s) => s.path === join("src", "rider", ts)), ts);
  }
  for (const kt of ["RiderSession.kt", "RiderTransport.kt", "RiderBridge.kt"]) {
    assert.ok(mobileKt.some((s) => s.path.endsWith(sep + kt)), kt);
  }
  assert.ok(![...mobileTs, ...mobileKt].some((s) => [...MOBILE_SKIP].some((skip) => s.path.startsWith(skip + sep))));
  // Only those exact paths are skipped: the same names one level away are sources.
  for (const near of ["build", "public", join("android", "app", "src", "main", "build"), join("src", "public")]) {
    assert.ok(!MOBILE_SKIP.has(near), near);
  }
});

test("the phone shell's walk skips a folder by its exact path, never by its name", () => {
  // The walk itself, on a tree of its own (#668): the set above alone cannot show it.
  const root = mkdtempSync(join(tmpdir(), "mobile-walk-"));
  try {
    const put = (path: string) => {
      const p = join(root, ...path.split("/"));
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, "");
    };
    const skipped = ["node_modules/a.ts", "android/app/build/b.kt", "android/app/src/main/assets/public/c.js"];
    const scanned = ["src/node_modules/d.ts", "src/build/e.ts", "src/public/f.ts", "android/app/src/main/build/G.kt", "build/h.ts"];
    for (const p of [...skipped, ...scanned]) put(p);
    const found = mobileFiles(root, /\.(ts|js|kt)$/, root).map((p) => relative(root, p).split(sep).join("/"));
    assert.deepEqual(found.sort(), [...scanned].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [what, re] of FORBIDDEN) {
  test(`no ${what} anywhere in the phone shell's TypeScript`, () => {
    const hits = mobileTs.filter((s) => re.test(code(s.text))).map((s) => s.path);
    assert.deepEqual(hits, []);
  });
}

// The Kotlin counterparts of the desktop's checks above: audio in or out (the desktop's audio
// elements, AudioContext and MediaSource; issue #627 names AudioRecord), any Spotify SDK, the
// camera (rule 12; the manifest test also bars its permission), equipment control and the network.
// A class or method name has no leading word boundary, so a prefix (`setResistance`, `newWebSocket`,
// `CronetEngine`, `ExoMediaPlayer`) cannot hide it; package names and short words keep theirs.
const KOTLIN_FORBIDDEN: readonly [string, RegExp][] = [
  [
    "audio playback or recording (rule 3)",
    /\bandroidx?\.media3?\b|MediaPlayer\b|\bexoplayer\w*|AudioTrack\b|AudioRecord\b|MediaRecorder\b|SoundPool\b|MediaSession\w*|AudioManager\b|JetPlayer\b|AsyncPlayer\b|ToneGenerator\b|\bRingtone\w*|VideoView\b|MediaCodec\b|MediaExtractor\b|\bAAudio\b|\boboe\b/i,
  ],
  ["a Spotify interface (rule 3)", /spotify/i],
  ["the camera (rule 12)", /\bandroid\.hardware\.camera2?\b|\bandroidx\.camera\b|CameraManager\b|CameraDevice\b|\bACTION_IMAGE_CAPTURE\b|\bACTION_VIDEO_CAPTURE\b/],
  ["equipment control (rule 2)", /writeCharacteristic\b|BluetoothGatt\b|BluetoothSocket\b|UsbManager\b|\bandroid\.hardware\.usb\b|resistance|incline|setSpeed|brake/i],
  [
    "a network request",
    /HttpURLConnection\b|HttpsURLConnection\b|URLConnection\b|openConnection\b|openStream\b|\bokhttp3?\b|\bjava\.net\.(Socket|URL|http)\b|DatagramSocket\b|HttpClient|WebSocket|\bktor\b|\bretrofit2?\b|\bvolley\b|cronet|DownloadManager\b/i,
  ],
];

// The one Kotlin exception (owner, 2026-11-26, #649; ADR 0011 section 8): the phone's backend
// calls (ADR 0011 sections 3 and 5) may use `HttpsURLConnection`, and `openConnection` to get one, in
// backend/BackendTransport.kt and only there. Those two words are taken out of the network check
// alone: every other way onto the network stays a hit in that file, the other checks stay in full
// there, and every other Kotlin file keeps the full network check.
const KT_NETWORK = "a network request";
const KT_BACKEND = ["android", "app", "src", "main", "kotlin", "org", "classbeat", "player", "backend"];
const BACKEND_TRANSPORT = join(...KT_BACKEND, "BackendTransport.kt");
// The second exception (owner, 2026-11-26, #653; ADR 0011 section 8): follow/SpotifySessionReader.kt
// may name the media-session types it reads, for the audio check alone, and the music app's package,
// for the Spotify check alone. Every other audio, player, recording and Spotify word stays a hit
// there, the other checks stay in full, and every other Kotlin file keeps the full checks.
const KT_AUDIO = "audio playback or recording (rule 3)";
const KT_SPOTIFY = "a Spotify interface (rule 3)";
const KT_FOLLOW = [...KT_BACKEND.slice(0, -1), "follow"];
const SESSION_READER = join(...KT_FOLLOW, "SpotifySessionReader.kt");
const SESSION_WORDS =
  /\bandroid\.media\.session\.(?:MediaSessionManager|MediaController|PlaybackState)\b|\bandroid\.media\.MediaMetadata\b|\bMediaSessionManager\b/g;
const MUSIC_APP = /"com\.spotify\.music"/g;
const KOTLIN_EXCEPTIONS: ReadonlyMap<string, ReadonlyMap<string, RegExp>> = new Map([
  [BACKEND_TRANSPORT, new Map([[KT_NETWORK, /\bHttpsURLConnection\b|\bopenConnection\b/g]])],
  [
    SESSION_READER,
    new Map([
      [KT_AUDIO, SESSION_WORDS],
      [KT_SPOTIFY, MUSIC_APP],
    ]),
  ],
]);
const KOTLIN_NETWORK_EXCEPTIONS: ReadonlyMap<string, RegExp> = new Map(
  [...KOTLIN_EXCEPTIONS].flatMap(([path, checks]) => (checks.has(KT_NETWORK) ? [[path, checks.get(KT_NETWORK)!] as const] : [])),
);
const ktChecked = (path: string, text: string, what: string): string => {
  const strip = KOTLIN_EXCEPTIONS.get(path)?.get(what);
  return strip ? text.replace(strip, " ") : text;
};

for (const [what, re] of KOTLIN_FORBIDDEN) {
  test(`no ${what} anywhere in the phone shell's Kotlin`, () => {
    const hits = mobileKt.filter((s) => re.test(ktChecked(s.path, code(s.text), what))).map((s) => s.path);
    assert.deepEqual(hits, []);
  });
}

test("the backend transport's exception is one file and two words, for the network check only", () => {
  const network = KOTLIN_FORBIDDEN.find(([w]) => w === KT_NETWORK)![1];
  assert.deepEqual([...KOTLIN_NETWORK_EXCEPTIONS.keys()], [BACKEND_TRANSPORT]);
  assert.deepEqual([...KOTLIN_NETWORK_EXCEPTIONS.values()].map((r) => r.source), ["\\bHttpsURLConnection\\b|\\bopenConnection\\b"]);
  const file = mobileKt.find((s) => s.path === BACKEND_TRANSPORT);
  assert.ok(file, "the exception names a file that exists");
  // The file uses what it is allowed, and without the exception it would be a hit.
  assert.match(code(file.text), /\bHttpsURLConnection\b/);
  assert.match(code(file.text), /\bopenConnection\(\)/);
  assert.match(code(file.text), network);
  // In that file every other way onto the network is still a hit, the plain HTTP connection too.
  for (const bad of [
    "conn as HttpURLConnection",
    "val c: URLConnection = u",
    "URL(u).openStream()",
    "import java.net.URL",
    "import java.net.Socket",
    "import java.net.http.HttpClient",
    "DatagramSocket()",
    "import okhttp3.OkHttpClient",
    "client.newWebSocket(r, l)",
    "import io.ktor.client.HttpClient",
    "import retrofit2.Retrofit",
    "CronetEngine.Builder(c).build()",
    "DownloadManager.Request(u)",
  ]) {
    assert.match(ktChecked(BACKEND_TRANSPORT, `URI(a).toURL().openConnection() as? HttpsURLConnection; ${bad}`, KT_NETWORK), network, bad);
  }
  // The other checks take no exception there.
  const others: [string, string][] = [
    ["audio playback or recording (rule 3)", "MediaPlayer()"],
    ["a Spotify interface (rule 3)", "spotify"],
    ["the camera (rule 12)", "import androidx.camera.core.ImageCapture"],
    ["equipment control (rule 2)", "gatt.writeCharacteristic(c)"],
  ];
  assert.equal(others.length, KOTLIN_FORBIDDEN.length - 1);
  for (const [what, bad] of others) {
    assert.match(ktChecked(BACKEND_TRANSPORT, `HttpsURLConnection openConnection ${bad}`, what), KOTLIN_FORBIDDEN.find(([w]) => w === what)![1], what);
  }
  // Any other file, the backend's other files too: both words are network requests.
  const elsewhere = [
    join(...KT_BACKEND, "TransportContract.kt"),
    join(...KT_BACKEND, "Calls.kt"),
    join(...KT_BACKEND.slice(0, -1), "MainActivity.kt"),
    join(...KT_BACKEND.slice(0, -1), "rider", "RiderTransport.kt"),
    join("android", "app", "src", "test", "kotlin", "org", "classbeat", "player", "backend", "BackendTransport.kt"),
    "BackendTransport.kt",
  ];
  for (const path of elsewhere) {
    assert.match(ktChecked(path, "u.openConnection()", KT_NETWORK), network, path);
    assert.match(ktChecked(path, "c as HttpsURLConnection", KT_NETWORK), network, path);
  }
});

const ktRule = (what: string): RegExp => KOTLIN_FORBIDDEN.find(([w]) => w === what)![1];

test("the Kotlin exceptions are two files, each for the checks and words the owner allowed", () => {
  assert.deepEqual([...KOTLIN_EXCEPTIONS.keys()], [BACKEND_TRANSPORT, SESSION_READER]);
  assert.deepEqual([...KOTLIN_EXCEPTIONS.get(BACKEND_TRANSPORT)!.keys()], [KT_NETWORK]);
  assert.deepEqual([...KOTLIN_EXCEPTIONS.get(SESSION_READER)!.keys()], [KT_AUDIO, KT_SPOTIFY]);
  assert.deepEqual(
    [...KOTLIN_EXCEPTIONS.get(SESSION_READER)!.values()].map((r) => r.source),
    [
      "\\bandroid\\.media\\.session\\.(?:MediaSessionManager|MediaController|PlaybackState)\\b|\\bandroid\\.media\\.MediaMetadata\\b|\\bMediaSessionManager\\b",
      '"com\\.spotify\\.music"',
    ],
  );
});

test("the session reader's exception is one file, the media-session types and the music app's package", () => {
  const file = mobileKt.find((s) => s.path === SESSION_READER);
  assert.ok(file, "the exception names a file that exists");
  const own = code(file.text);
  // The file uses what it is allowed, and without the exception it would be a hit.
  assert.match(own, ktRule(KT_AUDIO));
  assert.match(own, ktRule(KT_SPOTIFY));
  assert.equal([...own.matchAll(MUSIC_APP)].length, 1, "the package is named once");
  // In that file every other audio, player, recording and Spotify word is still a hit.
  for (const bad of [
    "MediaPlayer()",
    "AudioTrack.Builder().build()",
    "AudioRecord.Builder().build()",
    "MediaRecorder(c)",
    "import android.media.AudioManager",
    "import android.media.session.MediaSession",
    "val s = MediaSession(c, \"x\")",
    "MediaSessionCompat(c, \"x\")",
    "import androidx.media3.session.MediaController",
    "import androidx.media.session.MediaButtonReceiver",
    "import com.google.android.exoplayer2.ExoPlayer",
    "SoundPool.Builder().build()",
  ]) {
    assert.match(ktChecked(SESSION_READER, `import android.media.session.MediaController; MediaSessionManager; ${bad}`, KT_AUDIO), ktRule(KT_AUDIO), bad);
  }
  for (const bad of ['"com.spotify.music.debug"', '"spotify:playlist:x"', "import com.spotify.android.appremote.api.SpotifyAppRemote", "class SpotifyReader", '"com.spotify.mobile"']) {
    assert.match(ktChecked(SESSION_READER, `"com.spotify.music" ${bad}`, KT_SPOTIFY), ktRule(KT_SPOTIFY), bad);
  }
  // The other checks take no exception there: the network, the camera, equipment control.
  for (const [what, bad] of [
    [KT_NETWORK, "URL(u).openConnection()"],
    [KT_NETWORK, "c as HttpsURLConnection"],
    ["the camera (rule 12)", "import androidx.camera.core.ImageCapture"],
    ["equipment control (rule 2)", "gatt.writeCharacteristic(c)"],
  ]) {
    assert.match(ktChecked(SESSION_READER, `"com.spotify.music" MediaSessionManager ${bad}`, what), ktRule(what), bad);
  }
  // Any other file, the follow package's others too, keeps the full audio and Spotify checks.
  const elsewhere = [
    join(...KT_FOLLOW, "SessionReader.kt"),
    join(...KT_FOLLOW, "FollowListener.kt"),
    join(...KT_FOLLOW.slice(0, -1), "MainActivity.kt"),
    BACKEND_TRANSPORT,
    join("android", "app", "src", "test", "kotlin", "org", "classbeat", "player", "follow", "SpotifySessionReader.kt"),
    "SpotifySessionReader.kt",
  ];
  for (const path of elsewhere) {
    assert.match(ktChecked(path, "import android.media.session.MediaController", KT_AUDIO), ktRule(KT_AUDIO), path);
    assert.match(ktChecked(path, "val m: MediaSessionManager? = null", KT_AUDIO), ktRule(KT_AUDIO), path);
    assert.match(ktChecked(path, 'val app = "com.spotify.music"', KT_SPOTIFY), ktRule(KT_SPOTIFY), path);
  }
});

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

/** The problems in the session reader's source, one line each; empty when its rules hold. */
function readerProblems(text: string): string[] {
  const c = code(text);
  const found: string[] = [];
  const listed = [...c.matchAll(/getActiveSessions/g)].length;
  const filtered = [...c.matchAll(SESSION_FILTERED)];
  if (listed === 0 || filtered.length !== listed) found.push("a session list without the package filter");
  if (!/^private const val MUSIC_APP = "com\.spotify\.music"$/m.test(c)) found.push("the package is not the constant");
  if (SESSION_OTHER_WAYS.test(c)) found.push("another way to a session");
  const firstRead = c.search(SESSION_READ);
  if (firstRead >= 0 && (filtered.length === 0 || firstRead < filtered[0]!.index!)) found.push("a read before the filter");
  const keys = [...new Set([...c.matchAll(/METADATA_KEY_\w+/g)].map((m) => m[0]))].sort();
  const allowed = ["METADATA_KEY_ARTIST", "METADATA_KEY_DURATION", "METADATA_KEY_MEDIA_ID", "METADATA_KEY_TITLE"];
  if (keys.some((k) => !allowed.includes(k)) || METADATA_OTHER.test(c)) found.push("metadata beyond the track's identity");
  return found;
}

test("the session reader filters to the music app before any read, and reads only the track, the state and the position", () => {
  const file = mobileKt.find((s) => s.path === SESSION_READER)!;
  assert.deepEqual(readerProblems(file.text), []);
  // Each rule can fail.
  const filter = "?.filter { it.packageName == MUSIC_APP }";
  assert.ok(file.text.includes(filter));
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
  ];
  for (const [from, to, problem] of mutations) {
    const mutated = file.text.replace(from, to);
    assert.notEqual(mutated, file.text, from);
    assert.ok(readerProblems(mutated).includes(problem), `${to}: ${readerProblems(mutated).join("; ")}`);
  }
});

test("only the session reader names the media-session types and calls", () => {
  const naming = mobileKt.filter((s) => SESSION_NAMES.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(naming, [SESSION_READER]);
  for (const bad of ["c.transportControls.play()", "val s: PlaybackState? = x", "m.getActiveSessions(l)", "val t = c.metadata", "c.getPlaybackState()", "MediaMetadata.METADATA_KEY_TITLE"]) {
    assert.match(code(bad), SESSION_NAMES, bad);
  }
});

test("no Spotify SDK and no spotify: link anywhere in the phone shell", () => {
  const LINK = /spotify:/i;
  const SDK = /com\.spotify\.(?!music")|spotify[-_.]?(?:sdk|auth|android|app-?remote)|appremote|SpotifyAppRemote/i;
  // The SDK nowhere. A link nowhere in the app's sources, strings included; test fixtures may hold
  // a Spotify-style track id as the data a session reports, never as something opened.
  const isTest = (p: string): boolean => p.startsWith(`test${sep}`) || p.includes(`${sep}src${sep}test${sep}`);
  assert.deepEqual([...mobileTs, ...mobileKt].filter((s) => SDK.test(code(s.text))).map((s) => s.path), []);
  const app = [...mobileTs, ...mobileKt].filter((s) => !isTest(s.path));
  assert.ok(app.some((s) => s.path === SESSION_READER));
  assert.deepEqual(app.filter((s) => LINK.test(s.text)).map((s) => s.path), []);
  const pkg = readFileSync(join(MOBILE, "package.json"), "utf8");
  assert.doesNotMatch(pkg, /spotify/i);
  for (const bad of ['"spotify:playlist:abc"', "Uri.parse(\"SPOTIFY:track:x\")", "import com.spotify.android.appremote.api.SpotifyAppRemote", 'implementation("com.spotify.android:auth:2.1.0")', "import com.spotify.sdk.android.auth.AuthorizationClient"]) {
    assert.ok(LINK.test(bad) || SDK.test(code(bad)), bad);
  }
  assert.doesNotMatch(code('private const val MUSIC_APP = "com.spotify.music"'), SDK);
});

test("the notification listener stays empty and no Kotlin asks for the active notifications", () => {
  const LISTENER = join(...KT_FOLLOW, "FollowListener.kt");
  const EMPTY = /^package org\.classbeat\.player\.follow\s+import android\.service\.notification\.NotificationListenerService\s+class FollowListener : NotificationListenerService\(\)$/;
  const READS = /getActiveNotifications|activeNotifications/;
  const listener = mobileKt.find((s) => s.path === LISTENER)!;
  assert.match(code(listener.text).trim(), EMPTY);
  assert.deepEqual(mobileKt.filter((s) => READS.test(code(s.text))).map((s) => s.path), []);
  // Both can fail.
  const body = listener.text.replace("NotificationListenerService()", "NotificationListenerService() {\n    override fun onListenerConnected() {}\n}");
  assert.notEqual(body, listener.text);
  assert.doesNotMatch(code(body).trim(), EMPTY);
  for (const bad of ["getActiveNotifications()", "val n = activeNotifications"]) assert.match(code(bad), READS, bad);
});

// Anything that could make TLS accept a certificate or a host the system would refuse: a trust
// manager, a hostname verifier (set on a connection, as the default, or as a Kotlin property), an
// SSL context, a default factory, an insecure factory, a hand-made certificate check. No word
// boundary and any case, so the Java setters (`setHostnameVerifier`, `setDefaultHostnameVerifier`)
// and Kotlin's properties (`hostnameVerifier = `) are hits too. Reading the system's own verifier
// (`getDefaultHostnameVerifier()`) loosens nothing and is the one form left out.
const TLS_LOOSEN =
  /TrustManager|TrustAll|TrustEvery|(?<!getDefault)HostnameVerifier|SSLContext|(?<!get)Default\w*(Factory|Verifier)|ALLOW_ALL|getInsecure|SSLCertificateSocketFactory|checkServerTrusted|X509|NoopHostname|AllowAllHostname|InsecureTrust/i;
// Any SSL socket factory, as a type, a setter or a property.
const TLS_FACTORY = /SSLSocketFactory/i;
const ktMain = () => mobileKt.filter((s) => s.path.startsWith(join("android", "app", "src", "main") + sep));

test("only the backend transport handles TLS, and it never loosens the system's checks", () => {
  const main = ktMain();
  assert.ok(main.some((s) => s.path === BACKEND_TRANSPORT));
  // Every app Kotlin file, the transport too.
  assert.deepEqual(main.filter((s) => TLS_LOOSEN.test(code(s.text))).map((s) => s.path), []);
  // A socket factory is named only in the transport, where the tests hand in theirs.
  assert.deepEqual(main.filter((s) => TLS_FACTORY.test(code(s.text))).map((s) => s.path), [BACKEND_TRANSPORT]);
  // The app builds the transport without one: the system's trust store.
  const activity = code(main.find((s) => s.path.endsWith(sep + "MainActivity.kt"))!.text);
  assert.deepEqual([...activity.matchAll(/HttpsBackendTransport\(([^()]*)\)/g)].map((m) => m[1]), ["origin, main"]);
});

test("the TLS check catches every usual way to switch off certificate or hostname checks", () => {
  for (const bad of [
    "val v = HostnameVerifier { _, _ -> true }",
    "conn.setHostnameVerifier { _, _ -> true }",
    "conn.hostnameVerifier = HostnameVerifier { _, _ -> true }",
    "HttpsURLConnection.setDefaultHostnameVerifier { _, _ -> true }",
    "HttpsURLConnection.defaultHostnameVerifier = v",
    "HttpsURLConnection.setDefaultSSLSocketFactory(f)",
    "HttpsURLConnection.defaultSSLSocketFactory = f",
    "conn.sslSocketFactory = SSLCertificateSocketFactory.getInsecure(0, null)",
    "conn.sslSocketFactory = android.net.SSLCertificateSocketFactory.getDefault(0)",
    "object : X509TrustManager { }",
    "val tm = TrustManagerFactory.getInstance(a)",
    "override fun checkServerTrusted(c: Array<java.security.cert.X509Certificate>, a: String) {}",
    "val ctx = SSLContext.getInstance(\"TLS\")",
    "val c = javax.net.ssl.SSLContext.getDefault()",
    "SSLSocketFactory.ALLOW_ALL_HOSTNAME_VERIFIER",
    "NoopHostnameVerifier.INSTANCE",
    "val trustAll = arrayOf(t)",
  ]) {
    assert.match(code(bad), TLS_LOOSEN, bad);
  }
  // Reading the system's own verifier, and the transport's own use of a handed-in factory, are not hits.
  for (const fine of ["val v = HttpsURLConnection.getDefaultHostnameVerifier()", "tls?.let { conn.sslSocketFactory = it }", "conn.instanceFollowRedirects = false"]) {
    assert.doesNotMatch(code(fine), TLS_LOOSEN, fine);
  }
  for (const f of ["conn.setSSLSocketFactory(f)", "conn.sslSocketFactory = f", "val f: SSLSocketFactory? = null"]) {
    assert.match(code(f), TLS_FACTORY, f);
  }
});

test("only MainActivity builds the HTTPS backend transport", () => {
  // The origin is bound only by the constructor's argument, so no other file may name the class:
  // not to build one, not as a function reference, not through a type alias.
  const main = ktMain();
  const naming = main.filter((s) => /HttpsBackendTransport/.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(naming.sort(), [BACKEND_TRANSPORT, join(...KT_BACKEND.slice(0, -1), "MainActivity.kt")].sort());
  // The class's own file declares it and builds none, by call or by reference.
  const own = code(main.find((s) => s.path === BACKEND_TRANSPORT)!.text);
  assert.deepEqual([...own.matchAll(/HttpsBackendTransport\s*\(|::\s*HttpsBackendTransport/g)].length, 0);
  assert.match(own, /class HttpsBackendTransport internal constructor\(/);
  // MainActivity builds exactly one, and nothing else in it names the class but its import.
  const activity = code(main.find((s) => s.path.endsWith(sep + "MainActivity.kt"))!.text);
  assert.equal([...activity.matchAll(/HttpsBackendTransport/g)].length, 2);
  assert.match(activity, /^import org\.classbeat\.player\.backend\.HttpsBackendTransport$/m);
  assert.equal([...activity.matchAll(/HttpsBackendTransport\(origin, main\)/g)].length, 1);
  // The check can fail: a second construction or a reference elsewhere is a hit.
  assert.match(code("val t = HttpsBackendTransport(\"https://x.test\", p)"), /HttpsBackendTransport/);
  assert.match(code("val f = ::HttpsBackendTransport"), /::\s*HttpsBackendTransport/);
});

test("the Kotlin guard catches what it looks for, and not comments or java.net.URI", () => {
  const samples: readonly string[][] = [
    [
      "val p = MediaPlayer()",
      "val r = android.media.AudioRecord(1, 44100, 16, 2, 1024)",
      "val r = AudioRecord.Builder().build()",
      "val m = MediaRecorder(context)",
      "import android.media.MediaRecorder",
      "val t = AudioTrack.Builder().build()",
      "import androidx.media3.exoplayer.ExoPlayer",
      "import com.google.android.exoplayer2.SimpleExoPlayer",
      "val s = MediaSessionCompat(c, \"x\")",
      "val tone = ToneGenerator(0, 100)",
      "val pool = SoundPool.Builder().build()",
      "val p = ExoMediaPlayer(c)",
    ],
    ["import com.spotify.android.appremote.api.SpotifyAppRemote"],
    ["import android.hardware.camera2.CameraManager", "import androidx.camera.core.ImageCapture", "Intent(MediaStore.ACTION_IMAGE_CAPTURE)"],
    ["gatt.writeCharacteristic(c)", "socket: BluetoothSocket", "import android.hardware.usb.UsbDevice", "trainer.setResistanceLevel(5)", "ftms.targetIncline = 2", "bike.setSpeedTarget(30)", "applyBrakeForce(1)"],
    ["URL(u).openConnection()", "URL(u).openStream()", "import java.net.http.HttpClient", "DatagramSocket()", "import okhttp3.OkHttpClient", "client.newWebSocket(r, l)", "CronetEngine.Builder(c).build()", "val c = HttpClientBuilder.create()", "MyHttpsURLConnection(u)"],
  ];
  assert.equal(samples.length, KOTLIN_FORBIDDEN.length);
  KOTLIN_FORBIDDEN.forEach(([what, re], i) => {
    for (const sample of samples[i]) assert.match(code(sample), re, `${what}: ${sample}`);
  });
  for (const [what, re] of KOTLIN_FORBIDDEN) {
    assert.doesNotMatch(code("// a MediaPlayer or spotify or writeCharacteristic is never used"), re, what);
    assert.doesNotMatch(code("import java.net.URI\nval u = URI(url).normalize()"), re, what);
  }
});

// The one permission the phone shell asks for is INTERNET, for the HTTPS calls to the backend
// (owner, 2026-11-26, #649); ManifestTest checks the merged manifest against PermissionPolicy.
const asksFor = (manifest: string): string[] =>
  [...code(manifest).matchAll(/<uses-permission[\w-]*\b[^>]*?android:name="([^"]+)"/g)].map((m) => m[1]!);
const permissionTags = (manifest: string): number => [...code(manifest).matchAll(/<uses-permission/g)].length;

test("the phone shell's Android manifest asks for INTERNET and nothing else", () => {
  const manifest = readFileSync(MANIFEST, "utf8");
  assert.deepEqual(asksFor(manifest), ["android.permission.INTERNET"]);
  assert.equal(permissionTags(manifest), 1);
  // One more permission, in either tag, is caught.
  for (const extra of ["android.permission.CAMERA", "android.permission.ACCESS_NETWORK_STATE"]) {
    for (const tag of ["uses-permission", "uses-permission-sdk-23"]) {
      const more = manifest.replace("<application", `<${tag} android:name="${extra}" />\n    <application`);
      assert.notDeepEqual(asksFor(more), ["android.permission.INTERNET"], `${tag} ${extra}`);
      assert.notEqual(permissionTags(more), 1, `${tag} ${extra}`);
    }
  }
});

test("the phone shell imports nothing from the spikes", () => {
  const hits = [...mobileTs, ...mobileKt].filter((s) => /spikes?\//.test(code(s.text))).map((s) => s.path);
  assert.deepEqual(hits, []);
});

test("the phone shell's source files stay under about 300 lines (150 for its policy modules)", () => {
  const isTest = (p: string): boolean => p.startsWith(`test${sep}`) || p.includes(`${sep}src${sep}test${sep}`);
  for (const s of [...mobileTs, ...mobileKt].filter((f) => !isTest(f.path))) {
    const lines = s.text.split("\n").length;
    const cap = s.path.includes(`${sep}policy${sep}`) ? 150 : 300;
    assert.ok(lines <= cap, `${s.path}: ${lines} lines`);
  }
});

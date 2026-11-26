// Rule guards (plan section 3) and code structure rules (CLAUDE.md), checked on the source.
// Rule 2: no equipment control. Rule 3: no audio playback, no Spotify interface.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { REPO } from "./fixtures.ts";
import {
  BACKEND_TRANSPORT, code, KT_BACKEND, KT_FOLLOW, ktFile, type KtMutation, ktViews, MAIN_ACTIVITY, MOBILE, MOBILE_SKIP, mobileFiles,
  mobileKt, mobileTs, mutationGaps, SESSION_READER, type Views, withSource,
} from "./rule-sources.ts";
import {
  asksFor, AUDIO, AUDIO_EXCEPTIONS, callsSocket, checked, connects, coreIo, FORBIDDEN, forbidden, importsSocket, LIVE_SETUP, LIVE_SOCKET,
  liveLiterals, mixOnce, namesSdkTs, namesSpikesTs, NETWORK, NETWORK_EXCEPTIONS, permissions, permissionTags, ROOM_HTML, ROOM_MIX, SDK, wireUrls,
} from "./rules-ts.ts";

const SRC = join(REPO, "player", "app", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const sources = files(SRC).map((p) => ({ path: relative(SRC, p), text: readFileSync(p, "utf8") }));
// Comments may name a rule; the guards look at code only, in two views (rules-ts.ts, rule-sources.ts).
// The list, its exceptions and each check are in rules-ts.ts; rules-ts-mutations.test.ts tests them.

for (const [what] of FORBIDDEN) {
  test(`no ${what} anywhere in the app's source`, () => {
    const hits = sources.filter((s) => forbidden(what)(s.path, s.text)).map((s) => s.path);
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
  for (const path of AUDIO_EXCEPTIONS.keys()) {
    const s = sources.find((x) => x.path === path);
    assert.ok(s, `${path} exists`);
    // Exactly one element and one call, in either view: the exception covers no second one.
    assert.ok(!mixOnce(path, s.text), path);
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
  const text = (path: string): string => sources.find((s) => s.path === path)!.text;
  // It has no address of its own: no scheme or host, and any path is under /api/live/.
  assert.ok(!liveLiterals(LIVE_SOCKET, text(LIVE_SOCKET)));
  // The only address it is handed is the live socket's, built in core/live/host-wire.ts.
  const service = join("main", "live", "live-service.ts");
  assert.ok(!connects(service, text(service)));
  const wire = join("core", "live", "host-wire.ts");
  assert.ok(!wireUrls(wire, text(wire)));
});

test("only main/live/setup.ts calls into the live socket", () => {
  const importers = sources.filter((s) => importsSocket(s.path, s.text)).map((s) => s.path);
  assert.deepEqual(importers, [LIVE_SETUP]);
  const callers = sources.filter((s) => s.path !== LIVE_SOCKET && callsSocket(s.path, s.text)).map((s) => s.path);
  assert.deepEqual(callers, [LIVE_SETUP]);
});

test("the guard itself catches what it looks for", () => {
  assert.match(code("const a = new Audio('x');"), FORBIDDEN[0][1]);
  assert.match(code("c.writeValueWithResponse(buf)"), FORBIDDEN[2][1]);
  assert.doesNotMatch(code("// new Audio() is never used"), FORBIDDEN[0][1]);
});

test("the core is pure: no Electron, filesystem, network, process or DOM", () => {
  const hits = sources.filter((s) => s.path.startsWith("core") && coreIo(s.path, s.text)).map((s) => s.path);
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
  const hits = sources.filter((s) => namesSpikesTs(s.path, s.text)).map((s) => s.path);
  assert.deepEqual(hits, []);
});

// The phone shell (player/mobile, issue #627; its sources in rule-sources.ts) is held to the same
// rules: its TypeScript to the list above, with no exception, and its Kotlin to the list below.
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
    const skipped = ["node_modules/a.ts", "android/app/build/b.kt", "android/app/src/main/assets/public/c.js", "ios/App/App/public/i.js", "ios/App/Pods/j.ts"];
    const scanned = ["src/node_modules/d.ts", "src/build/e.ts", "src/public/f.ts", "android/app/src/main/build/G.kt", "build/h.ts", "ios/App/public/k.ts", "ios/Pods/l.ts"];
    for (const p of [...skipped, ...scanned]) put(p);
    const found = mobileFiles(root, /\.(ts|js|kt)$/, root).map((p) => relative(root, p).split(sep).join("/"));
    assert.deepEqual(found.sort(), [...scanned].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [what, re] of FORBIDDEN) {
  test(`no ${what} anywhere in the phone shell's TypeScript`, () => {
    // No exception here: the rule's own pattern, in either view.
    const hits = mobileTs.filter((s) => withSource(code, s.path)(s.text).some((v) => re.test(v))).map((s) => s.path);
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
// The second exception (owner, 2026-11-26, #653; ADR 0011 section 8): follow/SpotifySessionReader.kt
// may name the media-session types it reads, for the audio check alone, and the music app's package,
// for the Spotify check alone. Every other audio, player, recording and Spotify word stays a hit
// there, the other checks stay in full, and every other Kotlin file keeps the full checks.
const KT_AUDIO = "audio playback or recording (rule 3)";
const KT_SPOTIFY = "a Spotify interface (rule 3)";
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

const ktRule = (what: string): RegExp => KOTLIN_FORBIDDEN.find(([w]) => w === what)![1];
/** Whether a Kotlin file breaks one of the checks above, in any of its views, its exceptions taken out. */
const ktForbidden = (what: string) => (path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some((v) => ktRule(what).test(ktChecked(path, v, what)));

for (const [what] of KOTLIN_FORBIDDEN) {
  test(`no ${what} anywhere in the phone shell's Kotlin`, () => {
    const hits = mobileKt.filter((s) => ktForbidden(what)(s.path, s.text)).map((s) => s.path);
    assert.deepEqual(hits, []);
  });
}

test("the backend transport's exception is one file and two words, for the network check only", () => {
  const network = KOTLIN_FORBIDDEN.find(([w]) => w === KT_NETWORK)![1];
  assert.deepEqual([...KOTLIN_NETWORK_EXCEPTIONS.keys()], [BACKEND_TRANSPORT]);
  assert.deepEqual([...KOTLIN_NETWORK_EXCEPTIONS.values()].map((r) => r.source), ["\\bHttpsURLConnection\\b|\\bopenConnection\\b"]);
  const file = ktFile(BACKEND_TRANSPORT);
  // The file uses what it is allowed, and without the exception it would be a hit, in both views.
  for (const view of ktViews(file.text)) {
    assert.match(view, /\bHttpsURLConnection\b/);
    assert.match(view, /\bopenConnection\(\)/);
    assert.match(view, network);
  }
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

/** Whether the music app's package, the Spotify exception's one string, is named other than once. */
const musicAppNamedAgain = (_path: string, text: string, views: Views = ktViews): boolean =>
  views(text).some((v) => [...v.matchAll(MUSIC_APP)].length !== 1);

test("the session reader's exception is one file, the media-session types and the music app's package", () => {
  const file = ktFile(SESSION_READER);
  // The file uses what it is allowed, and without the exception it would be a hit, in both views.
  for (const own of ktViews(file.text)) {
    assert.match(own, ktRule(KT_AUDIO));
    assert.match(own, ktRule(KT_SPOTIFY));
  }
  assert.ok(!musicAppNamedAgain(SESSION_READER, file.text), "the package is named once");
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

const namesSdk = (_path: string, text: string, views: Views = ktViews): boolean => views(text).some((v) => SDK.test(v));

test("no Spotify SDK and no spotify: link anywhere in the phone shell", () => {
  const LINK = /spotify:/i;
  // The SDK nowhere. A link nowhere in the app's sources, strings included; test fixtures may hold
  // a Spotify-style track id as the data a session reports, never as something opened.
  const isTest = (p: string): boolean => p.startsWith(`test${sep}`) || p.includes(`${sep}src${sep}test${sep}`);
  assert.deepEqual(mobileTs.filter((s) => namesSdkTs(s.path, s.text)).map((s) => s.path), []);
  assert.deepEqual(mobileKt.filter((s) => namesSdk(s.path, s.text)).map((s) => s.path), []);
  const app = [...mobileTs, ...mobileKt].filter((s) => !isTest(s.path));
  assert.ok(app.some((s) => s.path === SESSION_READER));
  assert.deepEqual(app.filter((s) => LINK.test(s.text)).map((s) => s.path), []);
  const pkg = readFileSync(join(MOBILE, "package.json"), "utf8");
  assert.doesNotMatch(pkg, /spotify/i);
  for (const bad of ['"spotify:playlist:abc"', "Uri.parse(\"SPOTIFY:track:x\")", "import com.spotify.android.appremote.api.SpotifyAppRemote", 'implementation("com.spotify.android:auth:2.1.0")', "import com.spotify.sdk.android.auth.AuthorizationClient"]) {
    assert.ok(LINK.test(bad) || namesSdk("x.kt", bad), bad);
  }
  assert.ok(!namesSdk("x.kt", 'private const val MUSIC_APP = "com.spotify.music"'));
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
  KOTLIN_FORBIDDEN.forEach(([what], i) => {
    for (const sample of samples[i]) assert.ok(ktForbidden(what)("x.kt", sample), `${what}: ${sample}`);
  });
  for (const [what] of KOTLIN_FORBIDDEN) {
    for (const fine of ["// a MediaPlayer or spotify or writeCharacteristic is never used", "import java.net.URI\nval u = URI(url).normalize()"]) {
      assert.ok(!ktForbidden(what)("x.kt", fine), `${what}: ${fine}`);
    }
  }
});

test("the phone shell's Android manifest asks for INTERNET and nothing else", () => {
  const manifest = readFileSync(MANIFEST, "utf8");
  // In both views (rules-ts.ts): `code`, and the manifest with only its <!-- --> comments out.
  assert.ok(!permissions(MANIFEST, manifest));
  // One more permission, in either tag, is caught.
  for (const extra of ["android.permission.CAMERA", "android.permission.ACCESS_NETWORK_STATE"]) {
    for (const tag of ["uses-permission", "uses-permission-sdk-23"]) {
      const more = manifest.replace("<application", `<${tag} android:name="${extra}" />\n    <application`);
      assert.notDeepEqual(asksFor(code(more)), ["android.permission.INTERNET"], `${tag} ${extra}`);
      assert.notEqual(permissionTags(code(more)), 1, `${tag} ${extra}`);
      assert.ok(permissions(MANIFEST, more), `${tag} ${extra}`);
    }
  }
});

const namesSpikes = (_path: string, text: string, views: Views = ktViews): boolean => views(text).some((v) => /spikes?\//.test(v));

test("the phone shell imports nothing from the spikes", () => {
  assert.deepEqual(mobileTs.filter((s) => namesSpikesTs(s.path, s.text)).map((s) => s.path), []);
  assert.deepEqual(mobileKt.filter((s) => namesSpikes(s.path, s.text)).map((s) => s.path), []);
});

test("the phone shell's source files stay under about 300 lines (150 for its policy modules)", () => {
  const isTest = (p: string): boolean => p.startsWith(`test${sep}`) || p.includes(`${sep}src${sep}test${sep}`);
  for (const s of [...mobileTs, ...mobileKt].filter((f) => !isTest(f.path))) {
    const lines = s.text.split("\n").length;
    const cap = s.path.includes(`${sep}policy${sep}`) ? 150 : 300;
    assert.ok(lines <= cap, `${s.path}: ${lines} lines`);
  }
});

// Each Kotlin check above, shown to catch code that a "//" (or "/*") in a string on the same line
// hides from `code` (issue #859): the mutation applied to a real Kotlin file, `code` alone missing it.
const W = "val webView = bridge.webView";
const T = "tls?.let { conn.sslSocketFactory = it }";
const R = "override fun exists(): Boolean = manager != null";
const hidden = (anchor: string, after: string): string => `${anchor}; val s = "//"; ${after}`;
const KT_MUTATIONS: readonly KtMutation[] = [
  [KT_AUDIO, MAIN_ACTIVITY, W, hidden(W, "MediaPlayer().start()"), true],
  [KT_AUDIO, MAIN_ACTIVITY, W, `${W}; val s = "/*"; MediaPlayer().start() /* */`, true],
  [KT_AUDIO, SESSION_READER, R, hidden(R, "val p = MediaPlayer()"), true],
  [KT_SPOTIFY, MAIN_ACTIVITY, W, hidden(W, "spotifyLogin()"), true],
  [KT_SPOTIFY, SESSION_READER, R, hidden(R, 'val d = "com.spotify.music.debug"'), true],
  ["the camera (rule 12)", MAIN_ACTIVITY, W, hidden(W, "getSystemService(CameraManager::class.java)"), true],
  ["equipment control (rule 2)", MAIN_ACTIVITY, W, hidden(W, "gatt.writeCharacteristic(c)"), true],
  ["equipment control (rule 2)", BACKEND_TRANSPORT, T, hidden(T, "trainer.setResistanceLevel(5)"), true],
  [KT_NETWORK, MAIN_ACTIVITY, W, hidden(W, "URL(u).openStream()"), true],
  [KT_NETWORK, MAIN_ACTIVITY, W, `${W}; val s = "/*"; URL(u).openStream() /* */`, true],
  [KT_NETWORK, BACKEND_TRANSPORT, T, hidden(T, "DatagramSocket()"), true],
  [KT_NETWORK, SESSION_READER, R, hidden(R, "URL(u).openConnection()"), true],
  ["the music app's package named once", SESSION_READER, R, hidden(R, 'val o = "com.spotify.music"'), true],
  ["a Spotify SDK", MAIN_ACTIVITY, W, hidden(W, "SpotifyAppRemote.connect(c)"), true],
  ["the spikes", MAIN_ACTIVITY, W, hidden(W, 'val p = "spikes/follower"'), true],
];

test("every Kotlin check catches code a string's \"//\" hides on the same line", () => {
  const checks = new Map<string, (path: string, text: string, views?: Views) => boolean>([
    ...KOTLIN_FORBIDDEN.map(([what]) => [what, ktForbidden(what)] as const),
    ["the music app's package named once", musicAppNamedAgain],
    ["a Spotify SDK", namesSdk],
    ["the spikes", namesSpikes],
  ]);
  assert.deepEqual(mutationGaps(KT_MUTATIONS, checks), []);
  // Every check has one, and each exception file has one for each check it is excepted from.
  assert.deepEqual([...new Set(KT_MUTATIONS.map(([c]) => c))].sort(), [...checks.keys()].sort());
  for (const [path, excepted] of KOTLIN_EXCEPTIONS) {
    for (const what of excepted.keys()) assert.ok(KT_MUTATIONS.some(([c, p]) => c === what && p === path), `${path}: ${what}`);
  }
});

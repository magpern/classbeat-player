// Each TypeScript and markup check of rules.test.ts (rules-ts.ts), shown to catch code that a "//"
// (or "/*") in a string or in a page's text hides from `code` (issue #861): the mutation applied to a
// real source file, `code` alone missing it. The checks themselves are unchanged and only gain hits.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { appText, type Check, forbids, MOBILE, mobileTs, type Mutation, mutationGaps } from "./rule-sources.ts";
import {
  AUDIO, AUDIO_EXCEPTIONS, CALLS_SOCKET, callsSocket, CONNECTS, connects, CORE_IO, coreIo, FORBIDDEN, forbidden, IMPORTS_SOCKET, importsSocket,
  LIVE_LITERALS, LIVE_SOCKET, liveLiterals, MIX_ONCE, mixOnce, namesSdkTs, namesSpikesTs, NETWORK, NETWORK_EXCEPTIONS, PERMISSIONS, permissions,
  ROOM_HTML, ROOM_MIX, SPIKES, TS_SDK, wireUrls, WIRE_URLS,
} from "./rules-ts.ts";

const MANIFEST = join(MOBILE, "android", "app", "src", "main", "AndroidManifest.xml");
const PHONE_MAIN = join("src", "main.ts");
const read = (path: string): string =>
  path === MANIFEST ? readFileSync(MANIFEST, "utf8") : (mobileTs.find((s) => s.path === path)?.text ?? appText(path));

const SPOTIFY = "a Spotify interface (rule 3)";
const EQUIPMENT = "equipment control (rule 2)";
const SERVICE = join("main", "live", "live-service.ts");
const WIRE = join("core", "live", "host-wire.ts");
const MAIN = join("main", "main.ts");
// Real lines of those files, each the anchor its mutations follow.
const SOCK = "const runtimeSocket: OpenSocket = (url) => new WebSocket(url);";
const MIX = "audio.play().catch(() => {";
const HTML = '<audio id="mix" preload="auto"></audio>';
const DIAL = "const dial = (at: string, on: SocketEvents): LiveSocket => d.connect(liveSocketUrl(at), on);";
const URL_LINE = 'const url = new URL("/api/live/ws", origin);';
const IMPORT = 'import { app, BrowserWindow, ipcMain } from "electron";';
const PHONE = 'import "./install.ts";';
const hidden = (anchor: string, after: string): string => `${anchor} const s = "//"; ${after}`;
// A "/*" in a string: `code` takes out everything up to the "*/" in a later string, lines included.
const spanned = (anchor: string, lines: string): string => `${anchor}\nconst s = "/*";\n${lines}\nconst t = "*/";`;
const phone = (what: string): string => `the phone's TypeScript: ${what}`;

const MUTATIONS: readonly Mutation[] = [
  [AUDIO, LIVE_SOCKET, SOCK, hidden(SOCK, "new Audio(x);"), true],
  [AUDIO, ROOM_MIX, MIX, hidden(MIX, "el.play();"), true],
  [AUDIO, ROOM_MIX, MIX, hidden(MIX, "new AudioContext();"), true],
  [AUDIO, ROOM_HTML, HTML, `${HTML}<p>//</p><video></video>`, true],
  [AUDIO, ROOM_HTML, HTML, `${HTML}<p>//</p><audio src="x"></audio>`, true],
  [SPOTIFY, LIVE_SOCKET, SOCK, hidden(SOCK, "new Spotify.Player(o);"), true],
  [SPOTIFY, ROOM_MIX, MIX, hidden(MIX, 'load("https://api.spotify.com/v1");'), true],
  [EQUIPMENT, LIVE_SOCKET, SOCK, hidden(SOCK, "c.writeValue(b);"), true],
  [EQUIPMENT, ROOM_MIX, MIX, hidden(MIX, "navigator.usb.requestDevice(o);"), true],
  [NETWORK, LIVE_SOCKET, SOCK, hidden(SOCK, "fetch(u);"), true],
  [NETWORK, LIVE_SOCKET, SOCK, spanned(SOCK, "new EventSource(u);"), true],
  [NETWORK, ROOM_MIX, MIX, hidden(MIX, "fetch(u);"), true],
  [NETWORK, MAIN, IMPORT, hidden(IMPORT, "new WebSocket(u);"), true],
  [MIX_ONCE, ROOM_MIX, MIX, hidden(MIX, "audio.play();"), true],
  [MIX_ONCE, ROOM_HTML, HTML, `${HTML}<p>//</p>${HTML}`, true],
  [LIVE_LITERALS, LIVE_SOCKET, SOCK, `${SOCK} const s = "/api/live//*"; const u = "wss://elsewhere.example/x"; const t = "/api/live/*/";`, true],
  [CONNECTS, SERVICE, DIAL, hidden(DIAL, "d.connect(otherUrl(at), on);"), true],
  [WIRE_URLS, WIRE, URL_LINE, hidden(URL_LINE, 'new URL("https://elsewhere.example", origin);'), true],
  [IMPORTS_SOCKET, MAIN, IMPORT, spanned(IMPORT, 'import { webSocketConnect } from "./live/live-socket.ts";'), true],
  [CALLS_SOCKET, MAIN, IMPORT, hidden(IMPORT, "webSocketConnect(u, on);"), true],
  [CORE_IO, WIRE, URL_LINE, hidden(URL_LINE, "process.exit(1);"), true],
  [CORE_IO, WIRE, URL_LINE, spanned(URL_LINE, 'import { readFileSync } from "node:fs";'), true],
  [SPIKES, MAIN, IMPORT, hidden(IMPORT, 'import("../spikes/x.ts");'), true],
  [SPIKES, PHONE_MAIN, PHONE, hidden(PHONE, 'import("../spikes/x.ts");'), true],
  [phone(AUDIO), PHONE_MAIN, PHONE, hidden(PHONE, "new Audio(x);"), true],
  [phone(SPOTIFY), PHONE_MAIN, PHONE, hidden(PHONE, "new Spotify.Player(o);"), true],
  [phone(EQUIPMENT), PHONE_MAIN, PHONE, hidden(PHONE, "navigator.usb.requestDevice(o);"), true],
  [phone(NETWORK), PHONE_MAIN, PHONE, hidden(PHONE, "fetch(u);"), true],
  [TS_SDK, PHONE_MAIN, PHONE, hidden(PHONE, "SpotifyAppRemote.connect(c);"), true],
  [PERMISSIONS, MANIFEST, "<application", '<meta-data android:name="a" android:value="x//y" /><uses-permission android:name="android.permission.CAMERA" />\n    <application', true],
];

test('every TypeScript and markup rule check catches code a "//" or "/*" in a string hides from `code`', () => {
  const checks = new Map<string, Check>([
    ...FORBIDDEN.map(([what]) => [what, forbidden(what)] as const),
    ...FORBIDDEN.map(([what, re]) => [phone(what), forbids(re)] as const),
    [MIX_ONCE, mixOnce],
    [LIVE_LITERALS, liveLiterals],
    [CONNECTS, connects],
    [WIRE_URLS, wireUrls],
    [IMPORTS_SOCKET, importsSocket],
    [CALLS_SOCKET, callsSocket],
    [CORE_IO, coreIo],
    [SPIKES, namesSpikesTs],
    [TS_SDK, namesSdkTs],
    [PERMISSIONS, permissions],
  ]);
  assert.deepEqual(mutationGaps(MUTATIONS, checks, read), []);
  // Every check has one, and each exception file has one for each check it is excepted from.
  assert.deepEqual([...new Set(MUTATIONS.map(([c]) => c))].sort(), [...checks.keys()].sort());
  for (const [what, exceptions] of [[NETWORK, NETWORK_EXCEPTIONS], [AUDIO, AUDIO_EXCEPTIONS]] as const) {
    for (const path of exceptions.keys()) assert.ok(MUTATIONS.some(([c, p]) => c === what && p === path), `${path}: ${what}`);
  }
});

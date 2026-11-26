// The TypeScript and markup checks of rules.test.ts (plan section 3, rules 2 and 3), each a `Check`
// that hits in either view of a file (rule-sources.ts, issue #861): what `code` leaves, as before,
// and the file with only its real comments out, so a "//" or "/*" in a string hides nothing from it.
// rules-ts-mutations.test.ts shows each one catching code such a string hides from `code`.
import { join } from "node:path";
import { type Check, code, differs, forbids, withSource } from "./rule-sources.ts";

export const FORBIDDEN: readonly [string, RegExp][] = [
  ["audio playback (rule 3)", /\bnew\s+Audio\b|<audio\b|<video\b|\bAudioContext\b|\bwebkitAudioContext\b|\bMediaSource\b|\.play\(\)/],
  ["a Spotify interface (rule 3)", /spotify\.com|api\.spotify|sdk\.scdn|Spotify\.Player|spotify-web-api/i],
  ["equipment control (rule 2)", /\bwriteValue\w*\(|\bnavigator\.bluetooth\b|\bnavigator\.usb\b|\bnavigator\.serial\b|\bnavigator\.hid\b|\bresistance\b|\bincline\s*=|\bsetSpeed\b|\bbrake\b/i],
  ["a network request", /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|\bnet\.request\b|node:https?\b|require\(["']https?["']\)/],
];

// The one exception (owner, 2026-11-13, #173): the host's live connection to our own backend
// (ADR 0005 section 1) may name the runtime's `WebSocket` in main/live/live-socket.ts, and only
// there. It is taken out of the network check alone: audio, Spotify and equipment control stay
// fully enforced in that file, and every other file keeps the full network check.
export const LIVE_SOCKET = join("main", "live", "live-socket.ts");
export const LIVE_SETUP = join("main", "live", "setup.ts");
export const NETWORK = "a network request";
export const NETWORK_EXCEPTIONS: ReadonlyMap<string, RegExp> = new Map([[LIVE_SOCKET, /\bWebSocket\b/g]]);
// The second exception (ADR 0013 section 5, #693): the room window plays a Swedebeat mix, which
// plan rule 3 allows, through one `<audio>` element. Exactly that element in renderer/room.html and
// exactly its `audio.play()` in renderer/room-mix.ts are taken out of the audio check alone. Every
// other way to make sound stays a hit in those two files, and both words stay hits everywhere else.
export const AUDIO = "audio playback (rule 3)";
export const ROOM_HTML = join("renderer", "room.html");
export const ROOM_MIX = join("renderer", "room-mix.ts");
export const AUDIO_EXCEPTIONS: ReadonlyMap<string, RegExp> = new Map([
  [ROOM_HTML, /<audio id="mix" preload="auto"><\/audio>/g],
  [ROOM_MIX, /\baudio\.play\(\)/g],
]);
export const checked = (path: string, text: string, what: string): string => {
  const strip = what === NETWORK ? NETWORK_EXCEPTIONS.get(path) : what === AUDIO ? AUDIO_EXCEPTIONS.get(path) : undefined;
  return strip ? text.replace(strip, "") : text;
};

/** A forbidden rule of the list above, with its exceptions, in either view. */
export const forbidden =
  (what: string): Check =>
  (path, text, views = withSource(code, path)) => {
    const re = FORBIDDEN.find(([w]) => w === what)![1];
    return views(text).some((v) => re.test(checked(path, v, what)));
  };

/** Each exception covers exactly one element or call: a second one in either view is a hit. */
export const MIX_ONCE = "the mix's element and call, once each";
export const mixOnce: Check = (path, text, views = withSource(code, path)) =>
  views(text).some((v) => v.match(AUDIO_EXCEPTIONS.get(path)!)?.length !== 1);

/** The live socket's literals: no scheme or host, and any path under /api/live/. */
export const LIVE_LITERALS = "the live socket's own addresses";
export const liveLiterals: Check = (path, text, views = withSource(code, path)) =>
  views(text).some((v) =>
    [...v.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].some((m) => /:\/\/|^wss?:|^https?:/i.test(m[2]!) || (m[2]!.includes("/") && !/^\/api\/live\//.test(m[2]!))),
  );
/** The only address the live service hands the socket is the live socket's, from host-wire.ts. */
export const CONNECTS = "what the live service connects to";
export const connects = differs((v) => [...v.matchAll(/\bconnect\(([^,(]+)\(/g)].map((m) => m[1]!.trim()), ["liveSocketUrl"]);
export const WIRE_URLS = "the addresses host-wire.ts builds";
export const wireUrls = differs((v) => [...v.matchAll(/new URL\(("[^"]*")/g)].map((m) => JSON.parse(m[1]!) as string), ["/api/live/ws"]);

const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*from\s+["'][^"']*live-socket(?:\.ts)?["']/m;
/** Whether a file imports the live socket as a value, or calls it, in either view. */
export const IMPORTS_SOCKET = "imports the live socket";
export const importsSocket = forbids(VALUE_IMPORT);
export const CALLS_SOCKET = "calls the live socket";
export const callsSocket = forbids(/\bwebSocketConnect\b/);

export const IO = /from\s+["'](electron|node:fs|node:fs\/promises|fs|node:net|node:http|node:https|node:child_process|node:path|node:os|node:perf_hooks)["']|\b(window|document|process)\./;
export const CORE_IO = "the core does I/O";
export const coreIo = forbids(IO);
export const SPIKES = "imports from the spikes";
export const namesSpikesTs = forbids(/spikes?\//);
export const SDK = /com\.spotify\.(?!music")|spotify[-_.]?(?:sdk|auth|android|app-?remote)|appremote|SpotifyAppRemote/i;
export const TS_SDK = "a Spotify SDK in the phone's TypeScript";
export const namesSdkTs = forbids(SDK);

// The one permission the phone shell asks for is INTERNET, for the HTTPS calls to the backend
// (owner, 2026-11-26, #649); ManifestTest checks the merged manifest against PermissionPolicy.
export const asksFor = (view: string): string[] =>
  [...view.matchAll(/<uses-permission[\w-]*\b[^>]*?android:name="([^"]+)"/g)].map((m) => m[1]!);
export const permissionTags = (view: string): number => [...view.matchAll(/<uses-permission/g)].length;
export const PERMISSIONS = "the manifest asks for INTERNET alone";
export const permissions = differs((v) => [asksFor(v), permissionTags(v)], [["android.permission.INTERNET"], 1]);

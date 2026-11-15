// Shape checks on single Kotlin files, as allowlists: what a file may hold, not what it may not.
// Pure: each takes comment-stripped text and returns a problem or null.

const CALLBACK = /override\s+fun\s+(?:onNotificationPosted|onNotificationRemoved)\s*\(\s*\w+\s*:\s*StatusBarNotification\??\s*\)\s*\{\s*\}/g;

/** The listener file is the class header and the two empty callbacks: no init block, field or other member. */
export function listenerShapeProblem(text: string): string | null {
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

/** In the one file that calls getActiveSessions: its list is used only as `spotifyOnly(list) { it.packageName }`. */
export function sessionsProblem(text: string): string | null {
  const decl = /\bval\s+(\w+)\s*=\s*(?:try\s*\{\s*)?\w+\.getActiveSessions\s*\([^)]*\)\s*(?:\}\s*catch\b|$)/m.exec(text);
  if (!decl) return "getActiveSessions must be assigned alone to a val (`val x = try { manager.getActiveSessions(c) } catch ...`)";
  const name = decl[1]!;
  const use = `spotifyOnly\\(\\s*${name}\\s*\\)\\s*\\{\\s*it\\.packageName\\s*\\}`;
  if (!new RegExp(use).test(text)) return `the session list ${name} is never filtered with spotifyOnly(${name}) { it.packageName }`;
  const rest = text.replace(decl[0], "").replace(new RegExp(use, "g"), "");
  if (new RegExp(`\\b${name}\\b`).test(rest)) return `the session list ${name} is read other than through spotifyOnly(${name}) { it.packageName }`;
  return null;
}

/** In the file with getActiveSessions: the Spotify filter comes before any read of metadata or state. */
export function readerOrderProblem(t: string): string | null {
  const from = t.indexOf("getActiveSessions");
  const filter = t.indexOf("spotifyOnly(", from);
  const firstRead = Math.min(...[".metadata", ".playbackState", "getMetadata", "getPlaybackState"].map((k) => { const i = t.indexOf(k, from); return i < 0 ? Infinity : i; }));
  if (filter < 0) return "the active sessions are not filtered with spotifyOnly";
  return filter > firstRead ? "metadata or state is read before the Spotify filter" : null;
}

/** Every mention of blockNetworkLoads is exactly `blockNetworkLoads = true` ending its statement, or setBlockNetworkLoads(true). */
export function networkLoadsProblem(text: string): string | null {
  if (!/blocknetworkloads/i.test(text)) return null;
  const left = text
    .replace(/\bblockNetworkLoads[ \t]*=[ \t]*true[ \t]*(?:;|\r?\n(?=\s*(?:(?!(?:as|is|in)\b)[\w}]|$))|$)/g, "")
    .replace(/\bsetBlockNetworkLoads\(\s*true\s*\)/g, "");
  return /blocknetworkloads/i.test(left) ? "blockNetworkLoads may only appear as `blockNetworkLoads = true` ending its statement" : null;
}

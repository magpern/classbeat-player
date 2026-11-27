// The `cbp-local:` scheme the room window's two <audio> elements play the instructor's own music
// files from (ADR 0017 section 3). Pure: the scheme's privileges as one fixed allowlist and the only
// URL shape a play has. A URL names a random play id and nothing else: never a path, a file name,
// a SHA-256, the account or the class, so a page cannot name what it wants played.

export const LOCAL_SCHEME = "cbp-local";

/**
 * Exactly these privileges and no others, as for `cbp-mix:`: `standard` and `secure` so the URL
 * parses and counts as secure, `stream` so <audio> can read while it loads, `supportFetchAPI` for
 * the range requests. Never the privilege that bypasses a CSP: the room's CSP must name the scheme
 * in `media-src`, and no other page does.
 */
export const LOCAL_SCHEME_PRIVILEGES: Readonly<{ standard: true; secure: true; supportFetchAPI: true; stream: true }> = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
});

const LOCAL_PLAY_ID = /^[0-9a-f]{32}$/;
const LOCAL_PLAY_URL = /^cbp-local:\/\/play\/([0-9a-f]{32})$/;

export const localPlayUrl = (id: string): string => {
  if (!LOCAL_PLAY_ID.test(id)) throw new RangeError("not a play id");
  return `${LOCAL_SCHEME}://play/${id}`;
};

/** The play id of a URL of exactly the play shape (no query, fragment, port or other path), else null. */
export function localPlayIdOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(LOCAL_PLAY_URL);
  return m?.[1] ?? null;
}

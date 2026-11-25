// The `cbp-mix:` scheme the room window's <audio> plays a cached mix from (ADR 0013 section 5). Pure:
// the scheme's privileges as one fixed allowlist, the only URL shape a play has, and the byte range
// a request may ask for. A URL names a random play id and nothing else: no mix id, no account, no
// path, so a page cannot name what it wants played.

export const MIX_SCHEME = "cbp-mix";

/**
 * Exactly these privileges and no others: `standard` and `secure` so the URL parses and counts as
 * secure, `stream` so <audio> can read while it downloads, `supportFetchAPI` for the range requests.
 * Never the privilege that bypasses a CSP: the room's CSP must name the scheme in `media-src`, and no other page does.
 */
export const MIX_SCHEME_PRIVILEGES: Readonly<{ standard: true; secure: true; supportFetchAPI: true; stream: true }> = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
});

/** A play id: 128 random bits as 32 lower-case hex digits. */
export const PLAY_ID = /^[0-9a-f]{32}$/;

const PLAY_URL = /^cbp-mix:\/\/play\/([0-9a-f]{32})$/;

export const playUrl = (id: string): string => {
  if (!PLAY_ID.test(id)) throw new RangeError("not a play id");
  return `${MIX_SCHEME}://play/${id}`;
};

/** The play id of a URL of exactly the play shape (no query, fragment, port or other path), else null. */
export function playIdOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(PLAY_URL);
  return m?.[1] ?? null;
}

export type ByteRange = { readonly start: number; readonly end: number };

/**
 * The bytes a request asks for, `end` inclusive: the whole file without a Range header, one range
 * of `bytes=a-b`, `bytes=a-` or `bytes=-n`, clipped to the file. "unsatisfiable" for a range that
 * starts past the end, several ranges, or any other form.
 */
export function byteRange(header: string | null, length: number): ByteRange | "unsatisfiable" {
  if (length <= 0) return "unsatisfiable";
  if (header === null) return { start: 0, end: length - 1 };
  const m = header.trim().match(/^bytes=(\d{0,15})-(\d{0,15})$/);
  if (m === null) return "unsatisfiable";
  const [a, b] = [m[1] ?? "", m[2] ?? ""];
  if (a === "" && b === "") return "unsatisfiable";
  if (a === "") {
    const n = Number(b);
    return n === 0 ? "unsatisfiable" : { start: Math.max(0, length - n), end: length - 1 };
  }
  const start = Number(a);
  const end = b === "" ? length - 1 : Math.min(Number(b), length - 1);
  return start >= length || end < start ? "unsatisfiable" : { start, end };
}

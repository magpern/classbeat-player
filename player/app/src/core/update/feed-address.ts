// The release feed's address (ADR 0014, section 1). Pure. The default is the repository's releases
// list; a test or a development build may set another one in the main process's settings file, never
// from the renderer. Only `https:` is taken, with no user name or password; anything else is refused
// and the check then ends in "could not check" without a request.
export const DEFAULT_FEED = "https://api.github.com/repos/magpern/classbeat-player/releases?per_page=100";
/** Longer than any address a feed needs; a longer one is refused. */
export const MAX_FEED_LENGTH = 2048;

/** The address as the fetch should use it, or null when it is not one the checker may call. */
export function parseFeedAddress(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "" || raw.length > MAX_FEED_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return url.href;
}

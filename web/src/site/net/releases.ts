// The one read of the download page: the release file the site's build wrote into its own bundle
// (docs/design/download.md, "Where the data comes from"). A request to the site's own origin for
// one of its own files: nothing goes to GitHub or anywhere else, and nothing is sent but the request.

/** The file's name in the bundle, beside the page's script. */
export const RELEASES_FILE = "/releases.json";

/** The text of the release file, or null when it cannot be read (no answer, or not a success). */
export async function readReleasesText(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_FILE, { credentials: "omit", cache: "no-cache", redirect: "error", referrerPolicy: "no-referrer" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

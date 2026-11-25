// The download page's data and words (docs/design/download.md). Pure: the text of the release
// file in, a state out; no network, no clock, no DOM. The file is written when the site is built
// and read from the site's own bundle; this is the one place that decides what it may hold.

export interface Asset {
  readonly system: string;
  readonly file: string;
  readonly url: string;
  /** 64 lowercase hex characters, as `SHA256SUMS` gives them. */
  readonly sha256: string;
  readonly signed: boolean;
}

export interface Release {
  /** The tag without its `player-v` prefix, such as `0.1.0` or `0.2.0-rc.1`. */
  readonly version: string;
  readonly prerelease: boolean;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly notes_url: string;
  readonly assets: readonly Asset[];
}

/** What the page shows once the file has been read: a release, none yet, or a file that cannot be used. */
export type Reading = { readonly kind: "found"; readonly release: Release } | { readonly kind: "none" } | { readonly kind: "unreadable" };

/** The systems of the page, in the order the rows have; the loading rows name them before the data is read. */
export const SYSTEMS: readonly string[] = ["macOS, Apple silicon", "macOS, Intel", "Windows, 64-bit", "Linux, 64-bit"];

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FILE = /^[A-Za-z0-9._-]{1,120}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SYSTEM = /^[A-Za-z0-9 ,.()-]{1,60}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An address on GitHub over https, with no sign-in part and no port: the only place the page links to. */
function githubAddress(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "github.com" && u.port === "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

function assetOf(v: unknown): Asset | null {
  if (!isRecord(v)) return null;
  const { system, file, url, sha256, signed } = v;
  if (typeof system !== "string" || !SYSTEM.test(system)) return null;
  if (typeof file !== "string" || !FILE.test(file)) return null;
  if (!githubAddress(url)) return null;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  if (typeof signed !== "boolean") return null;
  return { system, file, url, sha256, signed };
}

function releaseOf(v: unknown): Release | null {
  if (!isRecord(v)) return null;
  const { version, prerelease, date, notes_url, assets } = v;
  if (typeof version !== "string" || !VERSION.test(version)) return null;
  if (typeof prerelease !== "boolean") return null;
  if (typeof date !== "string" || dateWords(date) === "") return null;
  if (!githubAddress(notes_url)) return null;
  if (!Array.isArray(assets) || assets.length === 0 || assets.length > 16) return null;
  const list: Asset[] = [];
  for (const a of assets) {
    const asset = assetOf(a);
    if (asset === null) return null;
    list.push(asset);
  }
  // A system is listed once: two rows with one heading would not say which to take.
  if (new Set(list.map((a) => a.system)).size !== list.length) return null;
  return { version, prerelease, date, notes_url, assets: list };
}

/** The state for the text of the release file; anything that is not exactly what the build writes is `unreadable`. */
export function readingOf(text: string): Reading {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  if (!isRecord(data) || !("release" in data)) return { kind: "unreadable" };
  if (data.release === null) return { kind: "none" };
  const release = releaseOf(data.release);
  return release === null ? { kind: "unreadable" } : { kind: "found", release };
}

const leap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** "25 Nov 2026" from `2026-11-25`, or "" for a date that is not one. No clock, no time zone. */
export function dateWords(iso: string): string {
  const m = DATE.exec(iso);
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const last = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (last === undefined || day < 1 || day > last) return "";
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** The checksum as eight groups of eight characters, in two halves of four groups (a copy has no spaces). */
export function checksumGroups(sha256: string): readonly (readonly string[])[] {
  const groups = sha256.match(/.{8}/g) ?? [];
  return [groups.slice(0, 4), groups.slice(4)];
}

/** The notice above the list: its head, or null when every listed build is signed. */
export function unsignedHead(assets: readonly Asset[]): string | null {
  const unsigned = assets.filter((a) => !a.signed).length;
  if (unsigned === 0) return null;
  return unsigned === assets.length ? "These builds are unsigned" : "Some builds are unsigned";
}

/**
 * The notice's lines. Only the sentence the spec fixes: the owner's wording for opening an
 * unsigned build is not set yet (docs/design/download.md, open item 1), and nothing stands in for it.
 */
export const UNSIGNED_LINES: readonly string[] = ["macOS and Windows will warn you when you open them."];

export interface CheckLine {
  readonly family: string;
  readonly text: string;
}

/** "Check a download": a line for each family the release has a row for, never one for a system it lacks. */
export function checkLines(assets: readonly Asset[]): readonly CheckLine[] {
  const has = (prefix: string): boolean => assets.some((a) => a.system.startsWith(prefix));
  const out: CheckLine[] = [];
  if (has("macOS") || has("Linux")) out.push({ family: "macOS and Linux", text: "Run shasum -a 256 on the file and compare the result with the checksum above." });
  if (has("Windows")) out.push({ family: "Windows", text: "Run certutil -hashfile on the file with SHA256 and compare the result with the checksum above." });
  return out;
}

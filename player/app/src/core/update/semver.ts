// SemVer 2.0.0 for the updater (ADR 0014, sections 1 and 2): the version check and precedence.
// Pure. A version that fails this check is never offered, compared or put in an address.

export interface Version {
  /** The version exactly as given; it passed the check below, so it holds only [0-9A-Za-z.+-]. */
  readonly text: string;
  /** Major, minor and patch as decimal strings with no leading zero (compared without `Number`). */
  readonly core: readonly [string, string, string];
  /** The pre-release identifiers; empty for a stable version. Build metadata is dropped. */
  readonly pre: readonly string[];
}

/**
 * Longer than any version the release workflow makes. A cap keeps a crafted tag from growing the
 * address or the comparison without bound; SemVer itself sets none.
 */
export const MAX_VERSION_LENGTH = 64;

const NUM = "0|[1-9][0-9]*";
const PRE_ID = "0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*";
const BUILD_ID = "[0-9A-Za-z-]+";
// The grammar of semver.org, written out with ASCII classes and anchored to the whole text (no `m`
// flag, so `$` is the end of the input and a trailing newline fails).
const SEMVER = new RegExp(
  `^(${NUM})\\.(${NUM})\\.(${NUM})` + `(?:-((?:${PRE_ID})(?:\\.(?:${PRE_ID}))*))?` + `(?:\\+${BUILD_ID}(?:\\.${BUILD_ID})*)?$`,
);

/** The version in `raw`, or null when it is not a string holding exactly one SemVer version. */
export function parseVersion(raw: unknown): Version | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_VERSION_LENGTH) return null;
  const m = SEMVER.exec(raw);
  if (!m) return null;
  return { text: raw, core: [m[1]!, m[2]!, m[3]!], pre: m[4] === undefined ? [] : m[4].split(".") };
}

/** A pre-release is a version with a hyphen part (ADR 0014, section 1). */
export function isPrerelease(v: Version): boolean {
  return v.pre.length > 0;
}

const DIGITS = /^[0-9]+$/;

/** Two decimal strings with no leading zero, compared by value at any length. */
function compareNumeric(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareIdentifier(a: string, b: string): number {
  const an = DIGITS.test(a);
  const bn = DIGITS.test(b);
  if (an && bn) return compareNumeric(a, b);
  if (an !== bn) return an ? -1 : 1; // numeric identifiers sort before alphanumeric ones
  return a === b ? 0 : a < b ? -1 : 1; // ASCII order
}

/** SemVer precedence: negative when `a` is lower, 0 when equal (build metadata ignored), positive when higher. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    const c = compareNumeric(a.core[i]!, b.core[i]!);
    if (c !== 0) return c;
  }
  // A stable version is higher than any pre-release of the same core.
  if (a.pre.length === 0 || b.pre.length === 0) return a.pre.length === b.pre.length ? 0 : a.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const c = compareIdentifier(a.pre[i]!, b.pre[i]!);
    if (c !== 0) return c;
  }
  return a.pre.length === b.pre.length ? 0 : a.pre.length < b.pre.length ? -1 : 1;
}

/** True only when `candidate` is strictly higher than `current`; an equal or older version is not newer. */
export function isNewer(candidate: Version, current: Version): boolean {
  return compareVersions(candidate, current) > 0;
}

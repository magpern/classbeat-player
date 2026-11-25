# 0014. The desktop player's updater

Status: Proposed. Becomes Accepted when a Reviewer passes its pull request. Installing updates by
itself waits for the owner's signing identities (docs/owner.md); until then the player only says
that a new version exists.

## Context

The plan asks for "signed automatic updates from the repository's releases" (section on the
desktop player) and lists the updater in PL7. The release workflow (#760, hardened in #784)
publishes each player version as a GitHub Release with the tag `player-vX.Y.Z`: one
`classbeat-player-<system>-<cpu>-unsigned.tar.gz` per target (linux-x64, macos-arm64, macos-x64,
windows-x64) and a `SHA256SUMS` file. The builds are unsigned until the owner provides an Apple
Developer membership and a Windows signing identity (docs/owner.md). The repository is public, so
its releases can be read without an account.

An updater is a way to run new code on every studio's computer. A wrong or stolen release must
not become an installed player, and an update must never interrupt a class.

## Decision

### 1. The feed

- The player reads the repository's releases from GitHub's REST API over `https:` only, from a
  fixed address built into the app
  (`https://api.github.com/repos/magpern/classbeat-player/releases?per_page=100`). Only that first
  page is read; a player release older than the newest 100 releases is never offered.
- A setting in the main process's settings file may point it at another `https:` address that
  serves the same shape. The renderer can never read or set that address. While the player only
  tells (section 2), the address changes what is displayed and nothing else; when installing is
  switched on, the signer check of section 2 holds whatever the address.
- It considers only published, non-draft releases whose tag is `player-v` followed by a SemVer
  version. A release is a pre-release when its tag has a hyphen part, the rule of the download
  page (docs/design/download.md); the API's `prerelease` flag is ignored. Unlike the page, which
  shows the highest pre-release when no stable release exists, the player considers pre-releases
  only when the user has turned on "Pre-releases" in its settings (off by default); with that off
  and no stable release, it reports "up to date".
- The request carries no cookie, account token, device identifier or class data, only a
  `User-Agent` naming the player and its version. It is made from the main process with Node's
  `fetch` (not `net.fetch` on the app's session, whose request filter would refuse it), following
  the pattern of `pairing/http.ts`: `redirect: "manual"` (a redirect is "could not check"), a
  10-second `AbortSignal.timeout`, and a read capped at 1 MiB. A reply that is not 200, too large,
  not JSON or the wrong shape is "could not check", never a partial result.
- The player checks at start and then every 6 hours while it runs, and when the user presses
  "Check now". A setting turns the automatic checks off; "Check now" still works.

### 2. What the player does with a newer version: tell, then (later) install

**Now: tell only.** When the feed has a newer version, the player shows a notice outside the
class (in the class list and in settings) with the version and a button that opens the release's
page in the system browser. The renderer cannot navigate or open windows (`hardening.ts`), so the
button calls the bridge's "open release page", which takes no argument. The main process builds
the address itself from the validated version it holds,
`https://github.com/magpern/classbeat-player/releases/tag/player-v<version>` where `<version>` has
passed the SemVer check, and opens it with `shell.openExternal`. No address from the feed or the
renderer is ever opened. The player downloads nothing and installs nothing.

**After signing: install.** Installing by itself is switched on only for a system whose build is
code-signed, and only with all of these:
- the archive's SHA-256 matches its line in the release's `SHA256SUMS` (this catches a broken
  download, not a forged release, because both come from the same place);
- the operating system's signature check passes, and the signer is the identity pinned in the
  running app (the Apple Team ID on macOS, the publisher on Windows), so a release built by anyone
  else is refused even if it is on the repository's releases;
- the new version is strictly higher than the running one (no downgrade, and no "same version
  again"), compared using the version recorded inside the signed package, not the feed's tag.

The Linux build has no operating-system signature and stays on "tell only" until an amendment to
this ADR pins a signing key for it. The install mechanism (Electron's own updater or another) is
chosen in that amendment, behind an interface, and reviewed at top tier. That amendment pins, on
macOS, the full designated requirement (Team ID and bundle identifier) and requires notarisation,
and on Windows, the certificate's subject and issuer or its thumbprint, not a publisher name alone.

### 3. Never during a class

- No notice is shown while a class is playing or paused mid-class, and a check that ends during a
  class keeps its result until the class ends.
- An install is applied only at the next start of the player (or when the user chooses "Restart
  to update" outside a class), never while a class is open.

### 4. Rollback

When installing is switched on, the previous version is kept. A start marker naming the new
version is written before the new version is launched, and the new version clears it once the
class list has rendered. The marker is checked by something that runs before the new version's own
code, so a build that fails before its code runs is still caught: a small launcher kept from the
previous version, or the install mechanism's own first-run check. The amendment of section 2
names which. If a start finds the marker of the same new version twice in a row, it goes back to
the kept version and marks the new one as skipped; it is offered again only when a higher version
appears.

### 5. Where it lives

- A pure module (`player/app/src/core/update/`) holds the rules: reading a feed reply into release
  records, picking the latest per channel, comparing versions, the class gate and the rollback
  state. It imports no I/O.
- The main process holds the fetch, the timer and the settings. It gives the renderer these
  bridge calls only:
  - the update status: the current version, the latest version, and "up to date", "newer",
    "checking" or "could not check";
  - "check now";
  - "open release page", which takes no argument;
  - two setters that each take one boolean: automatic checks on or off, and pre-releases on or
    off. A value that is not a boolean is refused.

  The renderer never gets or sets a URL, a file path, the feed address, or a way to start an
  install. The shell hardening (`hardening.ts` and `web-preferences.ts`: sandbox, context
  isolation, refused navigation and windows) is unchanged.

### 6. Tests

The pure module is table-tested with recorded feed replies in `player/app/test/fixtures/updates/`:
the stable and pre-release choice, drafts, foreign tags, a malformed or oversize reply, an older or
equal version, the class gate and the rollback steps. The main-process part is tested against an
injected fake feed. Nothing in CI calls GitHub or any other host.

## How the work splits

1. design: the update notice in the class list and the "Updates" part of settings ("Check now",
   automatic checks, pre-releases), with the "could not check" and "up to date" states (Designer,
   spec and mock-ups).
2. player: the pure update module and its fixtures. Security-critical.
3. player: the main-process checker, settings and the two bridge calls, and the notice built
   against the spec (after 1 and 2). Security-critical; a user sees it.
4. Later, when the owner provides signing: an amendment to this ADR choosing the install
   mechanism, then its build.

## Alternatives

- **Install unsigned builds checked only by `SHA256SUMS`.** Rejected: the checksum comes from the
  same release as the archive, so it proves nothing about who built it.
- **Read the feed from the classbeat site's `releases.json`.** Possible later through the feed
  setting; not the default, because the site is not deployed yet and would add a server we run to
  the update path.
- **GitHub's "latest release" address.** Rejected: it is per repository, not per tag prefix, and
  ignores the pre-release choice.
- **No updater; users visit the download page.** Studios would stay on old versions; the plan asks
  for updates.

## Consequences

- PL7's updater can be built and tested now; the player tells users about new versions on every
  system. Installing by itself waits for signing.
- Every player makes an anonymous request to GitHub every 6 hours. Many players behind one address
  stay well under GitHub's unauthenticated limit at that rate; a studio that blocks GitHub sees
  "could not check" and can turn checks off.
- A change to the release tag or asset names in the workflow must keep this ADR's feed rules, or
  amend them.

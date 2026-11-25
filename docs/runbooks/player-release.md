# Runbook: release the desktop player

Files: `.github/workflows/release-player.yml`, `scripts/check-release-tag.sh`,
`scripts/package-desktop.sh`, `scripts/release-player-assets.sh`, `scripts/test-release-player.sh`.
Download page: [docs/design/download.md](../design/download.md). Updater design: ADR 0014
(proposed; not merged yet). The backend's own runbook is [backend-deploy.md](backend-deploy.md).

A release is a tag. Pushing a `player-vX.Y.Z` tag on a commit of `main` makes the workflow build
the player for four targets, write `SHA256SUMS` and publish a GitHub Release with the archives.
**The builds are unsigned** (see section 6). The workflow holds no secrets and never creates,
moves or deletes a tag.

## 1. Choose the version and the tag

1. Pick the next SemVer 2.0.0 version `X.Y.Z`. The tag is `player-v` plus the version:
   `player-v0.1.0`.
2. A tag with a hyphen part is a **pre-release**: `player-v0.2.0-rc.1`. The release is then marked
   "Pre-release" on GitHub and on the download page. A tag without a hyphen is a stable release.
3. The tag must be on a commit that is on `main`, and `main` must be green. The workflow refuses a
   tag that is not SemVer (leading zeros, a missing part) or whose commit is not on `main`, before
   anything is built.
4. Never reuse a version. A version once pushed is spent, even if its release failed.

## 2. Dry run first (workflow_dispatch)

A dry run builds every target and writes `SHA256SUMS` but publishes nothing.

1. On GitHub: Actions, "release-player", "Run workflow". Pick the branch `main` and leave
   "dry_run" ticked (the default). Or from a terminal:

   ```bash
   gh workflow run release-player.yml --ref main -f dry_run=true
   gh run list --workflow release-player.yml --limit 3
   ```

2. Wait for all jobs. The `checksums` job prints `SHA256SUMS` in its log and in the run summary:
   four lines, one per archive. The archives and `SHA256SUMS` are kept as the artifact
   `release-player-assets` for 7 days, for inspection.
3. A dispatch with `dry_run` unticked is refused unless it runs on a `player-v` tag. Publish by
   pushing a tag (section 3), not by dispatch from a branch.
4. A pull request that changes the workflow or its scripts runs the same dry run on its own.

## 3. Push the tag

From a clean checkout, with `main` at the commit to release:

```bash
git fetch origin main
git tag -a player-vX.Y.Z -m "player-vX.Y.Z" origin/main
git push origin player-vX.Y.Z
gh run list --workflow release-player.yml --limit 3
```

Replace `X.Y.Z` (add `-rc.1` for a pre-release). The push starts the workflow; follow it with
`gh run watch <run-id>`. If it fails, read section 7.

## 4. What the workflow checks and publishes

| Job | What it does |
|---|---|
| `verify` | Runs `scripts/test-release-player.sh`. Checks the tag with `scripts/check-release-tag.sh`: SemVer, and the tagged commit is an ancestor of `main`. Sets the version and the pre-release flag. A tag that fails stops the run before any build |
| `build` | One runner per target: Linux x64, macOS Apple silicon (arm64), macOS Intel (x64), Windows x64. Each checks that the runner's CPU matches the target, then `npm ci`, fetches the Electron runtime, `npm run build` and `scripts/package-desktop.sh`. No npm cache |
| `checksums` | Collects the four archives and runs `scripts/release-player-assets.sh`: fails if an archive is missing or empty, or if any other file is present; writes `SHA256SUMS` and `RELEASE_NOTES.md` |
| `publish` | Runs only for an accepted `player-v` tag, never on a pull request. Runs `sha256sum -c --strict SHA256SUMS` and checks that every archive has a line. Checks that the remote tag still points at the built commit (a moved or deleted tag fails here). Then `gh release create --verify-tag` with the notes and the files |

What a release holds:

| File | System |
|---|---|
| `classbeat-player-macos-arm64-unsigned.tar.gz` | macOS, Apple silicon |
| `classbeat-player-macos-x64-unsigned.tar.gz` | macOS, Intel |
| `classbeat-player-windows-x64-unsigned.tar.gz` | Windows x64 |
| `classbeat-player-linux-x64-unsigned.tar.gz` | Linux x64 |
| `SHA256SUMS` | One line per archive, `sha256sum` format |

The release title is "classbeat player X.Y.Z". The notes are `RELEASE_NOTES.md` (it says the builds
are unsigned) above GitHub's generated notes. An existing release is never replaced: `gh` fails
instead. Check the result:

```bash
gh release view player-vX.Y.Z --repo magpern/classbeat-player
```

## 5. Verify an archive against SHA256SUMS

Download the archive for your system and `SHA256SUMS` from the release page
(`https://github.com/magpern/classbeat-player/releases`) into one empty folder. The checksum is
64 hex characters; compare it with the line for your file in `SHA256SUMS`.

**macOS** (Terminal), in that folder:

```bash
shasum -a 256 classbeat-player-macos-arm64-unsigned.tar.gz
grep classbeat-player-macos-arm64-unsigned.tar.gz SHA256SUMS
```

Use the `macos-x64` name on an Intel Mac. The two hashes must be identical.

**Linux**, in that folder:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

It prints `OK` for the file you downloaded. `--ignore-missing` skips the archives you did not
download.

**Windows** (PowerShell), in that folder:

```powershell
(Get-FileHash .\classbeat-player-windows-x64-unsigned.tar.gz -Algorithm SHA256).Hash.ToLower()
Select-String classbeat-player-windows-x64-unsigned.tar.gz SHA256SUMS
```

The first command prints the hash; the second prints the line from `SHA256SUMS`. They must be
identical (`certutil -hashfile <file> SHA256` also works in Command Prompt). A different hash means
the file is damaged or is not the release's file: delete it and download again; if it still
differs, do not open it and tell the owner.

Unpack with `tar -xzf <file>` (Windows 10 and later include `tar`). The archive holds one folder,
`classbeat-player-<system>`, with the Electron runtime and the built app. Open `Electron.app`
(macOS), `electron.exe` (Windows) or `electron` (Linux) inside it.

## 6. Unsigned builds

Code signing and macOS notarisation need the owner's signing identities (an Apple Developer
membership and a Windows signing identity; see [docs/owner.md](../owner.md)). Until the owner
provides them, **every release is unsigned**: the workflow has no signing step and holds no
secrets, and the file names carry `-unsigned`.

What a user sees:

- **macOS:** Gatekeeper refuses to open the app at first, with a message that it is from an
  unidentified developer or cannot be checked. On a Mac managed by a company that blocks apps from
  unknown sources, it may not open at all (docs/owner.md).
- **Windows:** SmartScreen warns that the publisher is unknown.
- **Linux:** no warning.

The release notes and the [download page](../design/download.md) say the builds are unsigned. The
wording of how to open an unsigned build is the owner's (download.md, open item 1); do not invent
it here. When signing exists, the workflow gains signing steps and this section is updated in the
same pull request.

## 7. Rollback

- **Never move or delete a pushed tag.** Not to retry, not to fix a mistake. The workflow checks
  that the tag still points at the built commit, and a moved tag breaks anyone who fetched it.
- **Fix forward.** Merge the fix to `main`, pick the next version (a new patch, or the next
  pre-release number) and release it by sections 1 to 4.
- **A bad release stays visible** until the fix is out. To warn people, the owner may edit its
  notes on GitHub; do not delete the release or its assets.
- **Tell users to reinstall the previous archive** from its own release page (the older
  `player-vX.Y.Z` release), verified against that release's `SHA256SUMS` (section 5). The player
  does not update itself yet (ADR 0014 (proposed) designs the updater), so a user stays on the
  version they installed until they install another.
- **A failed run** (a red job before `publish`) published nothing: fix the cause and push a new
  tag. If `publish` itself failed after creating the release, treat the version as spent too.

## 8. After a release: the download page

The download page shows the latest release, read when the site is built (download.md, "Where the
data comes from"). A new release shows only after the site is rebuilt.

1. Rebuild and redeploy the site (the deploy is the owner's; see
   [backend-deploy.md](backend-deploy.md)).
2. The page's data file, `releases.json`, is generated from the release's published files by the
   last step of the `publish` job (`scripts/site-releases-json.mjs`, #793). The step opens a pull
   request with the new file on a branch `site-releases-<tag>`; no change means no pull request.
   - It needs the repository setting "Allow GitHub Actions to create and approve pull requests"
     (owner, [owner.md](../owner.md)). Without it the step fails after the release was created:
     the release stands, `publish` shows red, and a `site-releases-<tag>` branch may be left over.
     Open the pull request from that branch by hand, or delete the branch and rerun the job.
   - A pull request opened with `GITHUB_TOKEN` starts no CI by itself. Push a commit to it or rerun
     its checks, then review and merge it like any other screens-lane pull request.
3. The backend's `/download` route serves the page and its files from a fixed list (#794).
4. After the rebuild, open the download page and check that the version, the pre-release mark and
   the four checksums match `SHA256SUMS` of the release.

#!/usr/bin/env bash
# Prepares the desktop player release assets (issue #760, plan PL7) in <dir>, which holds the
# packaged archives from scripts/package-desktop.sh:
#  - checks that the archive of every target is there, and nothing else;
#  - writes SHA256SUMS (sha256sum format, file names relative to <dir>);
#  - writes RELEASE_NOTES.md, the text put above GitHub's generated notes. The builds are
#    UNSIGNED and unnotarized until the owner provides signing (docs/owner.md), and it says so.
# Uses no secrets and publishes nothing.
# Usage: release-player-assets.sh <dir> <version>
set -euo pipefail

dir="${1:?dir}"
version="${2:?version}"
targets=(linux-x64 macos-arm64 macos-x64 windows-x64)

die() { echo "release-player-assets: $*" >&2; exit 1; }

[ -d "$dir" ] || die "no such directory: $dir"
cd "$dir"

want=()
for t in "${targets[@]}"; do
  f="classbeat-player-$t-unsigned.tar.gz"
  [ -s "$f" ] || die "missing or empty archive: $f"
  want+=("$f")
done
for f in *; do
  case " ${want[*]} " in
    *" $f "*) ;;
    *) die "unexpected file in $dir: $f" ;;
  esac
done

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -- "${want[@]}" >SHA256SUMS
else
  shasum -a 256 -- "${want[@]}" >SHA256SUMS
fi

cat >RELEASE_NOTES.md <<NOTES
## classbeat player $version

**These builds are unsigned and unnotarized.** Code signing and macOS notarisation are not set up
yet, so macOS Gatekeeper and Windows SmartScreen warn when the app is opened.

| System | File |
|---|---|
| Linux x64 | \`classbeat-player-linux-x64-unsigned.tar.gz\` |
| macOS, Apple silicon | \`classbeat-player-macos-arm64-unsigned.tar.gz\` |
| macOS, Intel | \`classbeat-player-macos-x64-unsigned.tar.gz\` |
| Windows x64 | \`classbeat-player-windows-x64-unsigned.tar.gz\` |

Check a download against \`SHA256SUMS\`: \`sha256sum -c SHA256SUMS --ignore-missing\`.
NOTES

echo "release-player-assets: wrote SHA256SUMS and RELEASE_NOTES.md for ${#want[@]} archives" >&2

#!/usr/bin/env bash
# Builds the desktop app on a developer Mac from a fresh clone: checks the prerequisites,
# installs and builds, then packages with scripts/package-desktop.sh (no packaging logic here).
# The result is UNSIGNED and unnotarized. This script does not touch quarantine or Gatekeeper
# and uses no signing material or secrets.
# Usage: build-mac.sh [--out DIR] [--help]      (default DIR: dist-local, under the repo root)
# Test hooks (environment): BUILD_MAC_UNAME, BUILD_MAC_NODE, BUILD_MAC_NPM,
# BUILD_MAC_XCODE_SELECT, BUILD_MAC_PACKAGE name the commands used instead of the real ones.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
uname_cmd="${BUILD_MAC_UNAME:-uname}"
node_cmd="${BUILD_MAC_NODE:-node}"
npm_cmd="${BUILD_MAC_NPM:-npm}"
xcode_cmd="${BUILD_MAC_XCODE_SELECT:-xcode-select}"
package_cmd="${BUILD_MAC_PACKAGE:-$here/package-desktop.sh}"
out="$root/dist-local"

usage() {
  cat <<'U'
Usage: scripts/build-mac.sh [--out DIR] [--help]

Builds the class player desktop app on a Mac (unsigned) and packages it as a .tar.gz.
Needs: macOS, Node 24, and the Xcode command line tools (xcode-select --install).

  --out DIR   where the archive is written (default: dist-local/ in the repository)
  --help      show this text
U
}

die() { echo "build-mac: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h) usage; exit 0 ;;
    --out)
      [ $# -ge 2 ] && [ -n "$2" ] || die "--out needs a directory"
      out="$2"; shift 2 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[ "$("$uname_cmd" -s)" = "Darwin" ] || die "this script builds on macOS only (found $("$uname_cmd" -s))"

command -v "$node_cmd" >/dev/null 2>&1 || die "Node 24 is required but node was not found"
node_major="$("$node_cmd" -p 'process.versions.node.split(".")[0]')"
[ "$node_major" = "24" ] || die "Node 24 is required (found major $node_major)"

"$xcode_cmd" -p >/dev/null 2>&1 || die "Xcode command line tools are missing: run xcode-select --install"

case "$("$uname_cmd" -m)" in
  arm64) label="macos-arm64" ;;
  x86_64) label="macos-x64" ;;
  *) die "unsupported CPU: $("$uname_cmd" -m)" ;;
esac

(cd "$root/schema/ts" && "$npm_cmd" ci)
(cd "$root/player/app" && "$npm_cmd" ci && "$npm_cmd" run build)

mkdir -p "$out"
out="$(cd "$out" && pwd)"
"$package_cmd" "$root/player/app" "$out" "$label"

archive="$out/classbeat-player-$label-unsigned.tar.gz"
cat <<MSG

Built: $archive
Unpack it with:
  tar -xzf "$archive" -C "$out"
The folder classbeat-player-$label/ then holds Electron.app, the app.
The build is unsigned; this script does not change quarantine or Gatekeeper settings.
MSG

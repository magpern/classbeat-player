#!/usr/bin/env bash
# Tests build-mac.sh with stub uname, node, npm, xcode-select and packager (no network, no Mac).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]" >&2; fail=1; fi
}
has() { # has <name> <needle> <text>
  case "$3" in *"$2"*) echo "ok   $1" ;; *) echo "FAIL $1: [$2] not in [$3]" >&2; fail=1 ;; esac
}

bin="$tmp/bin"
mkdir -p "$bin"
cat >"$bin/uname" <<'F'
#!/usr/bin/env bash
case "$1" in -s) echo "${FAKE_OS:-Darwin}" ;; -m) echo "${FAKE_ARCH:-arm64}" ;; esac
F
cat >"$bin/node" <<'F'
#!/usr/bin/env bash
echo "${FAKE_NODE_MAJOR:-24}"
F
cat >"$bin/npm" <<'F'
#!/usr/bin/env bash
echo "npm $* in ${PWD#"$ROOT_FOR_LOG"/}" >>"$LOG"
F
cat >"$bin/xcode-select" <<'F'
#!/usr/bin/env bash
[ -z "${FAKE_NO_XCODE:-}" ]
F
cat >"$bin/package" <<'F'
#!/usr/bin/env bash
echo "package ${1#"$ROOT_FOR_LOG"/} $3" >>"$LOG"
F
chmod +x "$bin"/*

export LOG="$tmp/log" ROOT_FOR_LOG
ROOT_FOR_LOG="$(cd "$here/.." && pwd)"
export BUILD_MAC_UNAME="$bin/uname" BUILD_MAC_NODE="$bin/node" BUILD_MAC_NPM="$bin/npm"
export BUILD_MAC_XCODE_SELECT="$bin/xcode-select" BUILD_MAC_PACKAGE="$bin/package"

run() { : >"$LOG"; set +e; out="$(bash "$here/build-mac.sh" "$@" 2>&1)"; rc=$?; set -e; }

run --help
check "help exits 0" 0 "$rc"
has "help mentions --out" "--out DIR" "$out"
check "help runs nothing" "" "$(cat "$LOG")"

run --bogus
check "unknown argument fails" 1 "$rc"
has "unknown argument named" "unknown argument: --bogus" "$out"

run --out
check "--out without value fails" 1 "$rc"

FAKE_OS=Linux run
check "refuses non-macOS" 1 "$rc"
has "non-macOS message" "macOS only" "$out"
check "non-macOS runs no install" "" "$(cat "$LOG")"

FAKE_NODE_MAJOR=22 run
check "refuses wrong Node major" 1 "$rc"
has "node message" "Node 24 is required (found major 22)" "$out"
check "wrong node runs no install" "" "$(cat "$LOG")"

FAKE_NO_XCODE=1 run
check "refuses without Xcode tools" 1 "$rc"
has "xcode message" "xcode-select --install" "$out"

FAKE_ARCH=riscv run
check "refuses unknown CPU" 1 "$rc"

run --out "$tmp/out"
check "success exits 0" 0 "$rc"
expected="npm ci in schema/ts
npm ci in player/app
npm run build in player/app
package player/app macos-arm64"
check "steps in order, packaging reused" "$expected" "$(cat "$LOG")"
has "prints archive path" "$tmp/out/classbeat-player-macos-arm64-unsigned.tar.gz" "$out"
has "prints unpack hint" "Electron.app" "$out"

FAKE_ARCH=x86_64 run --out "$tmp/out"
has "intel label" "package player/app macos-x64" "$(cat "$LOG")"

# The script must not touch quarantine or Gatekeeper.
if grep -Ev '^[[:space:]]*#' "$here/build-mac.sh" | grep -Eq 'xattr|spctl|codesign'; then
  echo "FAIL build-mac.sh calls xattr, spctl or codesign" >&2; fail=1
else
  echo "ok   no xattr, spctl or codesign"
fi

exit "$fail"

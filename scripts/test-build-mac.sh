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
echo "npm $* in ${PWD##*/}" >>"$LOG"
# Fake npm ci installing the Electron runtime, unless this run simulates a skipped script.
if [ "$1" = ci ] && [ "${PWD##*/}" = app ] && [ -z "${FAKE_SKIP_SCRIPTS:-}" ]; then
  mkdir -p node_modules/electron/dist
fi
F
cat >"$bin/xcode-select" <<'F'
#!/usr/bin/env bash
[ -z "${FAKE_NO_XCODE:-}" ]
F
cat >"$bin/package" <<'F'
#!/usr/bin/env bash
echo "package ${1##*/} $3" >>"$LOG"
F
cat >"$bin/fetch" <<'F'
#!/usr/bin/env bash
echo "fetch in ${PWD##*/}" >>"$LOG"
[ -n "${FAKE_FETCH_EMPTY:-}" ] || mkdir -p node_modules/electron/dist
F
cat >"$bin/tar" <<'F'
#!/usr/bin/env bash
echo "tar $*" >>"$LOG"
# Fake unpack: -C DIR is the 4th argument; leave a marker so a stale unpack is detectable.
mkdir -p "$4/classbeat-player-macos-arm64/Electron.app"
ls "$4/classbeat-player-macos-arm64" >>"$LOG"
touch "$4/classbeat-player-macos-arm64/new-$(date +%s%N)"
F
cat >"$bin/open" <<'F'
#!/usr/bin/env bash
echo "open $*" >>"$LOG"
[ -z "${FAKE_OPEN_FAIL:-}" ]
F
chmod +x "$bin"/*

export LOG="$tmp/log" ROOT_FOR_LOG
ROOT_FOR_LOG="$(cd "$here/.." && pwd)"
export BUILD_MAC_UNAME="$bin/uname" BUILD_MAC_NODE="$bin/node" BUILD_MAC_NPM="$bin/npm"
export BUILD_MAC_XCODE_SELECT="$bin/xcode-select" BUILD_MAC_PACKAGE="$bin/package"
export BUILD_MAC_ELECTRON_FETCH="$bin/fetch" BUILD_MAC_TAR="$bin/tar" BUILD_MAC_OPEN="$bin/open"

# The app folder is a scratch copy so tests never write into the repository.
run() { : >"$LOG"; rm -rf "$tmp/app"; mkdir -p "$tmp/app"; export BUILD_MAC_APP_DIR="$tmp/app"; set +e; out="$(bash "$here/build-mac.sh" "$@" 2>&1)"; rc=$?; set -e; }

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
expected="npm ci in ts
npm ci in app
npm run build in app
package app macos-arm64"
check "runtime present: steps in order, no fetch, packaging reused" "$expected" "$(cat "$LOG")"
has "prints archive path" "$tmp/out/classbeat-player-macos-arm64-unsigned.tar.gz" "$out"
has "prints unpack hint" "Electron.app" "$out"

FAKE_ARCH=x86_64 run --out "$tmp/out"
has "intel label" "package app macos-x64" "$(cat "$LOG")"

FAKE_SKIP_SCRIPTS=1 run --out "$tmp/out"
check "runtime missing: fetch runs, then packages" 0 "$rc"
expected="npm ci in ts
npm ci in app
npm run build in app
fetch in app
package app macos-arm64"
check "runtime missing: fetch between build and package" "$expected" "$(cat "$LOG")"
has "runtime missing: says so" "Electron runtime missing" "$out"

FAKE_SKIP_SCRIPTS=1 FAKE_FETCH_EMPTY=1 run --out "$tmp/out"
check "fetch producing nothing fails" 1 "$rc"
has "fetch failure message" "no Electron runtime after fetching it" "$out"
case "$(cat "$LOG")" in *package*) echo "FAIL packaged after a failed fetch" >&2; fail=1 ;; *) echo "ok   no packaging after a failed fetch" ;; esac

run --out "$tmp/out"
case "$(cat "$LOG")" in *"open "*|*"tar "*) echo "FAIL without --open: tar or open ran" >&2; fail=1 ;; *) echo "ok   without --open: no tar, no open" ;; esac

rm -rf "$tmp/out2"
run --open --out "$tmp/out2"
check "--open exits 0" 0 "$rc"
has "--open unpacks the archive" "tar -xzf $tmp/out2/classbeat-player-macos-arm64-unsigned.tar.gz -C $tmp/out2" "$(cat "$LOG")"
has "--open starts the app" "open $tmp/out2/classbeat-player-macos-arm64/Electron.app" "$(cat "$LOG")"
mkdir -p "$tmp/out2/classbeat-player-macos-arm64"
touch "$tmp/out2/classbeat-player-macos-arm64/stale-file"
run --open --out "$tmp/out2"
check "--open twice exits 0" 0 "$rc"
stale=gone; [ ! -e "$tmp/out2/classbeat-player-macos-arm64/stale-file" ] || stale=present
check "--open twice: second unpack replaced the first" gone "$stale"
has "--open twice starts the app again" "open $tmp/out2/classbeat-player-macos-arm64/Electron.app" "$(cat "$LOG")"

FAKE_OPEN_FAIL=1 run --open --out "$tmp/out2"
check "--open: refused open exits 1" 1 "$rc"
has "--open: refused open prints right-click step" "right-click Electron.app" "$out"

touch "$tmp/afile"
run --out "$tmp/afile"
check "bad --out fails" 1 "$rc"
has "bad --out message" "cannot use --out directory" "$out"
check "bad --out runs no npm" "" "$(cat "$LOG")"

# The script must not touch quarantine or Gatekeeper.
if grep -Ev '^[[:space:]]*#' "$here/build-mac.sh" | grep -Eiq 'xattr|spctl|codesign|quarantine'; then
  echo "FAIL build-mac.sh calls xattr, spctl, codesign or quarantine" >&2; fail=1
else
  echo "ok   no xattr, spctl, codesign or quarantine"
fi

exit "$fail"

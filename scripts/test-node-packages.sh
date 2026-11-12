#!/usr/bin/env bash
# Tests list-node-packages.sh and run-node-packages.sh against fixtures in a temp dir,
# with a fake npm and xvfb-run on PATH (no network, no real install).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]" >&2; fail=1; fi
}

mkpkg() { # mkpkg <dir> <package.json body> [nolock]
  mkdir -p "$1"
  printf '%s\n' "$2" >"$1/package.json"
  [ "${3-}" = nolock ] || echo '{}' >"$1/package-lock.json"
}

r="$tmp/repo"
mkdir -p "$r/player"
check "no packages: empty listing" "" "$(bash "$here/list-node-packages.sh" "$r")"
mkpkg "$r/player/spikes/a" '{"name":"a"}'
mkpkg "$r/player/scene/spike" '{"devDependencies":{"electron":"1"}}'
mkpkg "$r/player/nolock" '{"name":"x"}' nolock
mkpkg "$r/player/spikes/a/node_modules/dep" '{"name":"dep"}'
expected="player/scene/spike electron
player/spikes/a plain"
check "discovery, electron, lockfile required, node_modules skipped" "$expected" "$(bash "$here/list-node-packages.sh" "$r")"
check "no player dir" "" "$(bash "$here/list-node-packages.sh" "$tmp")"

# Fake tools: npm logs and fails `npm test` when the package dir has a FAIL marker;
# xvfb-run logs, drops its -a flag and execs the rest.
bin="$tmp/bin"
mkdir -p "$bin"
cat >"$bin/npm" <<'F'
#!/usr/bin/env bash
echo "npm $* in $(basename "$PWD")" >>"$LOG"
if [ "$1" = test ] && [ -f FAIL ]; then exit 1; fi
exit 0
F
cat >"$bin/xvfb-run" <<'F'
#!/usr/bin/env bash
echo "xvfb in $(basename "$PWD")" >>"$LOG"
shift
exec "$@"
F
chmod +x "$bin/npm" "$bin/xvfb-run"
export LOG="$tmp/log"

: >"$LOG"
PATH="$bin:$PATH" bash "$here/run-node-packages.sh" "$r" >/dev/null
check "passing run: npm ci and npm test per package" "4" "$(grep -c '^npm ' "$LOG")"
check "electron package ran under xvfb" "xvfb in spike" "$(grep '^xvfb' "$LOG")"

touch "$r/player/spikes/a/FAIL"
: >"$LOG"
if PATH="$bin:$PATH" bash "$here/run-node-packages.sh" "$r" >/dev/null 2>&1; then rc=0; else rc=$?; fi
check "failing package fails the run" "1" "$rc"
check "other packages still ran" "1" "$(grep -c 'npm test in spike' "$LOG")"

rm -rf "$r/player"
mkdir -p "$r/player"
: >"$LOG"
PATH="$bin:$PATH" bash "$here/run-node-packages.sh" "$r" >/dev/null
check "no packages: passes, runs nothing" "0" "$(grep -c . "$LOG" || true)"

exit "$fail"

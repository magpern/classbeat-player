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

# The scene renderer (#644): its `test` script ends with test:shots, which the scene-shots job runs.
# Here only the rest runs, and only while the script is exactly what run-node-packages.sh expects.
rm -rf "$r/player"
mkpkg "$r/player/scene/render" '{"scripts":{"test":"npm run lint && npm run typecheck && npm run test:unit && npm run test:shots"}}'
cat >"$bin/npm" <<'F'
#!/usr/bin/env bash
echo "npm $* in $(basename "$PWD")" >>"$LOG"
exit 0
F
: >"$LOG"
PATH="$bin:$PATH" bash "$here/run-node-packages.sh" "$r" >/dev/null
check "scene render: lint, typecheck and unit tests run" "3" "$(grep -cE '^npm run (lint|typecheck|test:unit) ' "$LOG")"
check "scene render: the shots do not run in node-packages" "0" "$(grep -c 'test:shots' "$LOG" || true)"
check "scene render: npm test is not run" "0" "$(grep -c '^npm test' "$LOG" || true)"
printf '%s\n' '{"scripts":{"test":"npm run lint && npm run test:shots && npm run extra"}}' >"$r/player/scene/render/package.json"
if PATH="$bin:$PATH" bash "$here/run-node-packages.sh" "$r" >/dev/null 2>&1; then rc=0; else rc=$?; fi
check "scene render: a changed test script fails the run (nothing runs unseen)" "1" "$rc"

exit "$fail"

#!/usr/bin/env bash
# Tests scripts/check-providers.sh in throwaway git repositories. Every case is built from the
# entries of scripts/provider-guard.txt, so no provider name is written in this file and a new
# list entry is tested without editing it.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
r="$tmp/r"

new_repo() {
  rm -rf "$r"
  mkdir -p "$r/scripts" "$r/docs" "$r/player"
  cp "$here/check-providers.sh" "$here/provider-guard.txt" "$r/scripts/"
  git -C "$r" init -q
  echo hello >"$r/README.md"
}

expect() { # expect <pass|fail> <name>
  local want="$1" name="$2" rc=0
  git -C "$r" add -A
  (cd "$r" && bash scripts/check-providers.sh >/dev/null 2>&1) || rc=$?
  if { [ "$want" = pass ] && [ "$rc" -ne 0 ]; } || { [ "$want" = fail ] && [ "$rc" -eq 0 ]; }; then
    echo "FAIL: $name (expected $want, exit $rc)"
    fail=1
  else
    echo "ok: $name"
  fi
}

hosts=()
packages=()
while read -r kind value _; do
  case "$kind" in
    host) hosts+=("$value") ;;
    package) packages+=("$value") ;;
  esac
done <"$here/provider-guard.txt"
[ "${#hosts[@]}" -gt 0 ] && [ "${#packages[@]}" -gt 0 ] || { echo "FAIL: guard list has no hosts or no packages"; exit 1; }

new_repo
expect pass "clean tree"

for h in "${hosts[@]}"; do
  new_repo
  echo "const u = 'https://$h/v1/x';" >"$r/player/a.ts"
  expect fail "host in source: $h"

  new_repo
  echo "const u = 'https://sub.$h/';" >"$r/player/a.ts"
  expect fail "subdomain in source: $h"

  new_repo
  echo "URL=HTTPS://$(echo "$h" | tr '[:lower:]' '[:upper:]')/" >"$r/player/config.env.txt"
  expect fail "upper-case host in a config file: $h"

  new_repo
  echo "{\"url\": \"https://$h/\"}" >"$r/player/data.json"
  expect fail "host in json: $h"

  new_repo
  echo "const u = 'https://x$h/';" >"$r/player/a.ts"
  expect pass "longer name ending the same way is not the host: $h"

  new_repo
  echo "see $h" >"$r/docs/note.md"
  echo "see $h" >"$r/AGENTS.md"
  echo "see $h" >"$r/README.md"
  expect pass "host in allowed places: $h"

  new_repo
  echo "see $h" >"$r/player/README.md"
  expect fail "host in a nested README: $h"
done

for p in "${packages[@]}"; do
  new_repo
  printf '{"dependencies":{"%s":"1.0.0"}}\n' "$p" >"$r/player/package.json"
  expect fail "package in package.json: $p"

  new_repo
  printf '{"packages":{"node_modules/%s":{"version":"1.0.0"}}}\n' "$p" >"$r/player/package-lock.json"
  expect fail "package in package-lock.json: $p"

  new_repo
  echo "$p==1.0" >"$r/player/requirements.txt"
  expect fail "package in requirements.txt: $p"

  new_repo
  echo "import x from \"$p\";" >"$r/player/a.ts"
  expect fail "package imported in ts: $p"

  new_repo
  echo "const x = require('$p/sub');" >"$r/player/a.js"
  expect fail "package required in js: $p"

  new_repo
  echo "import $p" >"$r/player/a.py"
  expect fail "package imported in python: $p"

  new_repo
  echo "// the $p package is banned" >"$r/player/a.ts"
  expect pass "package named in a comment is not an import: $p"

  new_repo
  printf '{"dependencies":{"%s-extra":"1.0.0"}}\n' "$p" >"$r/player/package.json"
  expect pass "different package with the same prefix: $p"

  new_repo
  echo "$p" >"$r/docs/note.md"
  echo "$p" >"$r/AGENTS.md"
  expect pass "package in allowed places: $p"
done

new_repo
mkdir -p "$r/player/a/b"
printf '{"dependencies":{"%s":"1"}}\n' "${packages[0]}" >"$r/player/a/b/package.json"
expect fail "package in a deeply nested manifest"

new_repo
: >"$r/scripts/provider-guard.txt"
expect fail "empty guard list"

new_repo
echo "bogus value" >>"$r/scripts/provider-guard.txt"
expect fail "unknown entry kind"

exit "$fail"

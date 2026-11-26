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
names=()
while read -r kind value _; do
  case "$kind" in
    host) hosts+=("$value") ;;
    package) packages+=("$value") ;;
    name) names+=("$value") ;;
  esac
done <"$here/provider-guard.txt"
[ "${#hosts[@]}" -gt 0 ] && [ "${#packages[@]}" -gt 0 ] || { echo "FAIL: guard list has no hosts or no packages"; exit 1; }

[ "${#names[@]}" -gt 0 ] || { echo "FAIL: guard list has no names"; exit 1; }

# A value is name-covered when a "name" entry matches it; such a value is allowed only in the
# ADR and the list, not in the other documents.
covered() { # covered <value>
  local n pat
  for n in "${names[@]}"; do
    pat="$(printf '%s' "$n" | sed -E 's#-#[^A-Za-z0-9]*#g')"
    if printf '%s' "$1" | grep -qiE -e "$pat"; then return 0; fi
  done
  return 1
}

# Pin a minimum set of "name" entries by the hash of the entry line ("name <value>"), so no
# provider name is written in this file and deleting one from the list fails a test.
sha() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1; }
pinned_hashes=(
  5d45d9b74bccc7d5cfa6f057ad06de4e08a48fd717d31af19ea32ac396f41db1
  79f9c23fe7c9bc8a1d99c96e09d68a1d7ac08847e3389ab1cfca84310b984297
)
pins_ok() { # pins_ok <list file>: every pinned entry is present
  local have want l
  have="$(grep -E '^name[[:space:]]' "$1" | sed -E 's/[[:space:]]+/ /g; s/ $//' | while read -r l; do printf '%s' "$l" | sha; done)"
  for want in "${pinned_hashes[@]}"; do
    grep -qx "$want" <<<"$have" || return 1
  done
}
if pins_ok "$here/provider-guard.txt"; then
  echo "ok: pinned name entries are in the list"
else
  echo "FAIL: a pinned name entry is missing from the guard list"
  fail=1
fi
for n in "${names[@]}"; do
  grep -vE "^name[[:space:]]+${n}[[:space:]]*\$" "$here/provider-guard.txt" >"$tmp/list-without"
  if pins_ok "$tmp/list-without"; then
    echo "FAIL: deleting a name entry is not caught by the pin"
    fail=1
  else
    echo "ok: deleting a name entry is caught by the pin"
  fi
done

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
  want=pass; covered "$h" && want=fail; expect "$want" "longer name ending the same way is not the host: $h"

  if covered "$h"; then
    new_repo
    mkdir -p "$r/docs/adr"
    echo "see $h" >"$r/docs/adr/0004-provider-terms.md"
    expect pass "name-covered host in ADR 0004: $h"
    for f in docs/note.md AGENTS.md README.md; do
      new_repo
      echo "see $h" >"$r/$f"
      expect fail "name-covered host in $f: $h"
    done
  else
    new_repo
    echo "see $h" >"$r/docs/note.md"
    echo "see $h" >"$r/AGENTS.md"
    echo "see $h" >"$r/README.md"
    expect pass "host in allowed places: $h"
  fi

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
  want=pass; covered "$p" && want=fail; expect "$want" "package named in a comment is not an import: $p"

  new_repo
  printf '{"dependencies":{"%s-extra":"1.0.0"}}\n' "$p" >"$r/player/package.json"
  want=pass; covered "$p" && want=fail; expect "$want" "different package with the same prefix: $p"

  if covered "$p"; then
    new_repo
    mkdir -p "$r/docs/adr"
    echo "$p" >"$r/docs/adr/0004-provider-terms.md"
    expect pass "name-covered package in ADR 0004: $p"
    new_repo
    echo "$p" >"$r/docs/note.md"
    expect fail "name-covered package in another doc: $p"
  else
    new_repo
    echo "$p" >"$r/docs/note.md"
    echo "$p" >"$r/AGENTS.md"
    expect pass "package in allowed places: $p"
  fi
done

for n in "${names[@]}"; do
  words="$(printf '%s' "$n" | tr '-' ' ')"
  upper="$(printf '%s' "$words" | tr '[:lower:]' '[:upper:]')"
  # Portable title case (GNU sed's \u is not in BSD sed): upper-case each word's first letter.
  title="$(printf '%s' "$words" | awk '{for (i = 1; i <= NF; i++) $i = toupper(substr($i, 1, 1)) substr($i, 2)} 1')"
  # The title-case step must really upper-case (a BSD sed `\u` would give a lower-case "u").
  case "$title" in
    [A-Z]*) [ "$title" != "$words" ] || { echo "FAIL: title case equals lower case: $n"; fail=1; } ;;
    *) echo "FAIL: title case does not start upper-case: $n"; fail=1 ;;
  esac
  if [ "$(printf '%s' "$title" | tr -cd '[:upper:]' | wc -c)" -ne "$(printf '%s' "$words" | wc -w)" ]; then
    echo "FAIL: title case must upper-case each word: $n"
    fail=1
  fi
  for spelling in "$words" "$upper" "$title"; do
    new_repo
    echo "// $spelling" >"$r/player/a.ts"
    expect fail "name in a source file: $spelling"

    new_repo
    mkdir -p "$r/player/test"
    echo "it('$spelling', () => {});" >"$r/player/test/a.test.ts"
    expect fail "name in a test: $spelling"

    new_repo
    mkdir -p "$r/player/test/fixtures"
    printf '{"title":"%s"}\n' "$spelling" >"$r/player/test/fixtures/class.json"
    expect fail "name in a fixture: $spelling"

    new_repo
    echo "see $spelling" >"$r/docs/note.md"
    expect fail "name in a docs page other than ADR 0004: $spelling"

    new_repo
    echo "see $spelling" >"$r/README.md"
    expect fail "name in README.md: $spelling"

    new_repo
    mkdir -p "$r/docs/adr"
    echo "see $spelling" >"$r/docs/adr/0005-other.md"
    expect fail "name in an ADR other than 0004: $spelling"

    new_repo
    mkdir -p "$r/docs/adr"
    echo "see $spelling" >"$r/docs/adr/0004-provider-terms.md"
    expect pass "name in ADR 0004: $spelling"

    new_repo
    printf 'GIF89a\000\001%s\000\002' "$spelling" >"$r/player/logo.bin"
    expect fail "name in a binary file: $spelling"
  done

  new_repo
  echo "// $(printf '%s' "$n" | tr -d '-')" >"$r/player/a.ts"
  expect fail "name without separator: $n"

  new_repo
  : >"$r/player/$n.ts"
  expect fail "name in a file name: $n"

  new_repo
  mkdir -p "$r/player/$n"
  : >"$r/player/$n/index.ts"
  expect fail "name in a directory name: $n"

  # Separators that git ls-files would quote (tab, newline, non-ASCII) must not hide the name.
  for sep in $'\t' $'\n' $'\xc2\xa0' ' ' '_'; do
    new_repo
    : >"$r/player/${n//-/$sep}.txt"
    expect fail "name in a file name with separator $(printf '%q' "$sep"): $n"
  done

  new_repo
  : >"$r/player/$(printf '%s' "$n" | tr -d '-' | tr '[:lower:]' '[:upper:]').txt"
  expect fail "name in a file name, upper case, no separator: $n"
done

new_repo
printf '%s\n' "packages:" "" "  /${packages[0]}@1.0.0:" "    resolution: {integrity: x}" >"$r/player/pnpm-lock.yaml"
expect fail "package in a pnpm v6 lock key"

# The guard reports file:line only, never the matching text.
new_repo
echo "const u = 'https://${hosts[0]}/secret-marker';" >"$r/player/a.ts"
git -C "$r" add -A
out="$(cd "$r" && bash scripts/check-providers.sh 2>&1 || true)"
if [ -z "$out" ] || grep -qE "secret-marker|${hosts[0]//./\\.}/" <<<"$out" || ! grep -q 'player/a.ts:1' <<<"$out"; then
  echo "FAIL: output must name file:line and not the matching text"
  fail=1
else
  echo "ok: output names file:line and not the matching text"
fi

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

#!/usr/bin/env bash
# Tests detect-changes.sh on synthetic commits in a temporary repository.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]" >&2; fail=1; fi
}

cd "$tmp"
git init -q -b main .
git config user.email t@example.com
git config user.name t
git config commit.gpgsign false
commit() { # commit <path>
  mkdir -p "$(dirname "$1")"
  echo "$RANDOM" >"$1"
  git add -A
  git commit -qm "change $1"
}
flags() { # flags <event> <base> <head>: the true flags, space separated
  local o="$tmp/output"
  : >"$o"
  GITHUB_OUTPUT="$o" EVENT="$1" BASE_SHA="$2" BEFORE_SHA="$2" HEAD_SHA="$3" bash "$here/detect-changes.sh"
  { grep '=true' "$o" || true; } | sed 's/=true//' | tr '\n' ' ' | sed 's/ $//'
}

commit README.md
fork="$(git rev-parse HEAD)"
git checkout -q -b feature
commit player/a.txt
feature="$(git rev-parse HEAD)"
git checkout -q main
commit web/b.txt
main_tip="$(git rev-parse HEAD)"

check "PR uses the merge base (main's own web change is ignored)" "player desktop" "$(flags pull_request "$main_tip" "$feature")"
check "push compares the two tips" "player desktop" "$(flags push "$fork" "$feature")"
check "push of web only" "web desktop" "$(flags push "$fork" "$main_tip")"
check "all-zero before means everything" "backend schema player web desktop" "$(flags push 0000000000000000000000000000000000000000 "$feature")"
check "unknown base means everything" "backend schema player web desktop" "$(flags pull_request deadbeefdeadbeefdeadbeefdeadbeefdeadbeef "$feature")"
commit scripts/other.sh
check "unrelated file sets no flag" "" "$(flags push "$main_tip" HEAD)"
before_wf="$(git rev-parse HEAD)"
commit .github/workflows/ci.yml
check "workflow change runs schema and desktop" "schema desktop" "$(flags push "$before_wf" HEAD)"

exit "$fail"

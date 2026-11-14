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
commit schema/class-format/v1/x.json
check "schema change runs backend, schema and desktop" "backend schema desktop" "$(flags push "$(git rev-parse HEAD~1)" HEAD)"
before_wf="$(git rev-parse HEAD)"
commit .github/workflows/ci.yml
check "workflow change runs backend, schema, player and desktop" "backend schema player desktop" "$(flags push "$before_wf" HEAD)"
before_tok="$(git rev-parse HEAD)"
commit docs/design/mockups/tokens.css
check "design token mock-up change runs web" "web" "$(flags push "$before_tok" HEAD)"
before_live="$(git rev-parse HEAD)"
commit schema/live/v1/examples/x.json
check "live schema example change runs backend, schema, web and desktop" "backend schema web desktop" "$(flags push "$before_live" HEAD)"
before_pol="$(git rev-parse HEAD)"
commit backend/src/player_backend/request_policy.py
check "request policy change runs backend and web" "backend web" "$(flags push "$before_pol" HEAD)"
before_ctl="$(git rev-parse HEAD)"
commit backend/tests/test_control_page.py
check "control page test change runs backend and web" "backend web" "$(flags push "$before_ctl" HEAD)"
before_rp="$(git rev-parse HEAD)"
commit backend/src/player_backend/rider_page_policy.py
check "rider page policy change runs backend and web" "backend web" "$(flags push "$before_rp" HEAD)"
before_cp="$(git rev-parse HEAD)"
commit backend/src/player_backend/control_page_policy.py
check "control page policy change runs backend and web" "backend web" "$(flags push "$before_cp" HEAD)"
commit backend/src/player_backend/other_page_policy.py
check "another backend source file runs backend only" "backend" "$(flags push "$(git rev-parse HEAD~1)" HEAD)"
commit backend/tests/test_other.py
check "other backend test runs backend only" "backend" "$(flags push "$(git rev-parse HEAD~1)" HEAD)"

exit "$fail"

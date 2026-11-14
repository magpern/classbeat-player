#!/usr/bin/env bash
# Writes per-lane change flags to $GITHUB_OUTPUT (or stdout when unset).
# Env: EVENT (pull_request|push), BASE_SHA (PR base), BEFORE_SHA (push before), HEAD_SHA.
# Anything unknown (new branch, all-zero before, missing commit) counts as "everything changed".
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
head="${HEAD_SHA:-HEAD}"
base=""
case "${EVENT-}" in
  pull_request) base="${BASE_SHA-}" ;;
  push) base="${BEFORE_SHA-}" ;;
  *) ;;
esac

all=0
files=""
if [ -z "$base" ] || [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  all=1
else
  # Pull requests use the merge base (base...head): only what the branch itself changed,
  # not what main gained since. Pushes compare the two tips.
  range="$base $head"
  [ "${EVENT-}" = pull_request ] && range="$base...$head"
  # shellcheck disable=SC2086
  files="$(git diff --name-only $range 2>/dev/null)" || all=1
fi

flag() { # flag <name> <extended regex>
  if [ "$all" -eq 1 ] || printf '%s\n' "$files" | grep -Eq "$2"; then
    echo "$1=true" >>"$out"
  else
    echo "$1=false" >>"$out"
  fi
}

# A workflow change also runs the backend, schema and player jobs, so a change to CI itself is exercised.
# The backend also depends on schema/ (the class format and the path dependency schema/python).
flag backend '^(backend/|schema/|\.github/workflows/)'
flag schema '^(schema/|\.github/workflows/)'
flag player '^(player/|\.github/workflows/|scripts/package-desktop\.sh)'
# The web tests also read files outside web/: the design specs and mock-ups under docs/design/
# (docs/design/mockups/tokens.css is compared with web/src/design/tokens.css, the checks are ported
# from docs/design/mockups/*.js), the live-session schema and examples under schema/live/, and
# backend/src/player_backend/request_policy.py (the fake's CSP is checked against it).
# web/test/unit/companion-fake-headers.test.ts reads backend/tests/test_control_page.py (the
# control page's header table), so a backend PR that changes only that file must run the web job (#347).
# web/test/lib/rider-policy.ts and its control equivalent read backend/src/player_backend/
# rider_page_policy.py and control_page_policy.py, so a backend-only change to either runs the web job (#375).
# A change there must run the whole web job, or main can go red unseen (issue #268).
# player/app/src/core/** and schema/generated/ts are already covered by the drift-only step,
# through the player and schema flags.
flag web '^(web/|docs/design/|schema/live/|backend/src/player_backend/request_policy\.py$|backend/src/player_backend/(rider|control)_page_policy\.py$|backend/tests/test_control_page\.py$)'
# Plan section 10: player, web, schema, build and packaging scripts, workflow files,
# dependency manifests and lockfiles.
flag desktop '^(player/|web/|schema/|scripts/(build|package|release)[^/]*|\.github/workflows/|(.*/)?(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt))'

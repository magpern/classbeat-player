#!/usr/bin/env bash
# Tests scripts/check-pr-title.sh with good and bad titles.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
fail=0

check() { # check <pass|fail> <title>
  local want="$1" title="$2" rc=0
  bash "$here/check-pr-title.sh" "$title" >/dev/null 2>&1 || rc=$?
  if { [ "$want" = pass ] && [ "$rc" -ne 0 ]; } || { [ "$want" = fail ] && [ "$rc" -eq 0 ]; }; then
    echo "FAIL: '$title' (expected $want)"
    fail=1
  else
    echo "ok: '$title'"
  fi
}

check pass "feat: add class clock"
check pass "fix(player): correct drift"
check pass "ci: CI skeleton, pull request title check and worktree script"
check pass "refactor(backend)!: rename tables"
check pass "docs(adr): class format"
check pass "revert: undo change"
check fail "Add class clock"
check fail "feature: add clock"
check fail "feat add clock"
check fail "feat:"
check fail "feat:no space"
check fail "feat(): empty scope"
check fail "Feat: capital type"
check fail ""

exit "$fail"

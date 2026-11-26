#!/usr/bin/env bash
# Tests check-screenshot-uploads.sh on the real workflow and on mutated copies (#875).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wf="$here/../.github/workflows/ci.yml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
expect() { # expect <ok|fail> <name> <file>
  local rc=0
  bash "$here/check-screenshot-uploads.sh" "$3" >/dev/null 2>&1 || rc=$?
  if { [ "$1" = ok ] && [ "$rc" -eq 0 ]; } || { [ "$1" = fail ] && [ "$rc" -eq 1 ]; }; then
    echo "ok   $2"
  else
    echo "FAIL $2 (exit $rc)" >&2
    fail=1
  fi
}
mutate() { # mutate <out> <sed expression>: edits only inside the app-screenshots step
  sed "/name: app-screenshots/,/retention-days/ $2" "$wf" >"$1"
  if cmp -s "$wf" "$1"; then echo "FAIL mutation changed nothing" >&2; fail=1; fi
}
expect ok "the workflow uploads only the PNG files" "$wf"
mutate "$tmp/dir" 's#path: player/mobile/screenshots/\*\.png#path: player/mobile/screenshots/#'
expect fail "mutation: the whole directory" "$tmp/dir"
mutate "$tmp/glob" 's#path: player/mobile/screenshots/\*\.png#path: player/mobile/*#'
expect fail "mutation: a wider glob" "$tmp/glob"
mutate "$tmp/multi" 's#path: player/mobile/screenshots/\*\.png#path: |\n            player/mobile/screenshots/*.png\n            player/mobile/.env#'
expect fail "mutation: an extra file named" "$tmp/multi"
grep -v 'name: app-screenshots' "$wf" >"$tmp/gone"
expect fail "mutation: the upload is missing" "$tmp/gone"
exit "$fail"

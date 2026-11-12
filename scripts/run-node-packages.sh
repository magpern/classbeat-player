#!/usr/bin/env bash
# Runs `npm ci && npm test` in every package that list-node-packages.sh finds. Electron
# packages run under xvfb-run. Every package runs even if an earlier one fails; the exit
# status is non-zero if any failed. Usage: run-node-packages.sh [repo-root]
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${1:-.}"
failed=0
n=0

while read -r dir kind; do
  [ -n "$dir" ] || continue
  n=$((n + 1))
  echo "::group::$dir ($kind)"
  if [ "$kind" = electron ]; then
    cmd=(xvfb-run -a bash -c 'npm ci && npm test')
  else
    cmd=(bash -c 'npm ci && npm test')
  fi
  if ! (cd "$root/$dir" && "${cmd[@]}"); then
    echo "FAILED: $dir" >&2
    failed=1
  fi
  echo "::endgroup::"
done < <(bash "$here/list-node-packages.sh" "$root")

echo "ran $n package(s)"
exit "$failed"

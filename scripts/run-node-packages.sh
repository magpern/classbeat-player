#!/usr/bin/env bash
# Runs `npm ci && npm test` in every package that list-node-packages.sh finds. Electron
# packages run under xvfb-run. Every package runs even if an earlier one fails; the exit
# status is non-zero if any failed. Usage: run-node-packages.sh [repo-root]
#
# One package is split (#644): player/scene/render's `npm test` ends with `test:shots`, which takes
# about 40 minutes in headless Chrome. Here it runs the rest of `npm test` (lint, typecheck, test:unit);
# the CI job `scene-shots` runs `npm run test:shots` and the `ci` gate requires it whenever the scene
# changes. The split holds only while the package's `test` script is exactly SCENE_TEST below; any
# other value fails the run, so a step added to it cannot go unrun.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${1:-.}"
failed=0
n=0
SCENE_DIR=player/scene/render
SCENE_TEST='npm run lint && npm run typecheck && npm run test:unit && npm run test:shots'
SCENE_REST='npm ci && npm run lint && npm run typecheck && npm run test:unit'

while read -r dir kind; do
  [ -n "$dir" ] || continue
  n=$((n + 1))
  echo "::group::$dir ($kind)"
  script='npm ci && npm test'
  if [ "$dir" = "$SCENE_DIR" ]; then
    actual="$(cd "$root/$dir" && node -p 'require("./package.json").scripts.test' 2>/dev/null || true)"
    if [ "$actual" = "$SCENE_TEST" ]; then
      script="$SCENE_REST"
      echo "$dir: test:shots runs in the scene-shots job"
    else
      echo "FAILED: $dir: its test script changed; update SCENE_TEST here and the scene-shots job" >&2
      failed=1
      echo "::endgroup::"
      continue
    fi
  fi
  if [ "$kind" = electron ]; then
    cmd=(xvfb-run -a bash -c "$script")
  else
    cmd=(bash -c "$script")
  fi
  if ! (cd "$root/$dir" && "${cmd[@]}"); then
    echo "FAILED: $dir" >&2
    failed=1
  fi
  echo "::endgroup::"
done < <(bash "$here/list-node-packages.sh" "$root")

echo "ran $n package(s)"
exit "$failed"

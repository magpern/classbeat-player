#!/usr/bin/env bash
# Checks that each screenshot upload in the CI workflow names only PNG files in its own directory, so no env
# file, token or other output can be swept in: `app-screenshots` (#875) uploads player/mobile/screenshots/*.png,
# `ios-screenshots` (#941, #990) uploads ${{ runner.temp }}/ios-screenshots/*.png.
# Usage: check-screenshot-uploads.sh [workflow-file]   (default: .github/workflows/ci.yml)
set -euo pipefail
wf="${1:-.github/workflows/ci.yml}"
check() { # check <artifact name> <the one allowed path>
  # Print the `path:` value lines of the upload-artifact step whose `name:` is the artifact.
  local paths
  paths="$(awk -v want="$1" '
    /^      - / { if (name == want) exit; name = ""; inpath = 0 }
    /^          name: / { name = $2 }
    name == want && /^          path:/ { inpath = 1; sub(/^          path: *\|?/, ""); if ($0 != "") print; next }
    inpath && /^            / { sub(/^ +/, ""); print; next }
    inpath && /^          [a-z]/ { inpath = 0 }
  ' "$wf")"
  if [ -z "$paths" ]; then
    echo "check-screenshot-uploads: no $1 upload path found in $wf" >&2
    exit 1
  fi
  if [ "$paths" != "$2" ]; then
    echo "check-screenshot-uploads: $1 must upload exactly $2, got:" >&2
    printf '%s\n' "$paths" >&2
    exit 1
  fi
  echo "ok $1 uploads only $2"
}
check app-screenshots 'player/mobile/screenshots/*.png'
# shellcheck disable=SC2016 # the expression is the workflow's text, not ours to expand
check ios-screenshots '${{ runner.temp }}/ios-screenshots/*.png'

#!/usr/bin/env bash
# Checks that the `app-screenshots` upload in the CI workflow names only PNG files under
# player/mobile/screenshots/ (#875), so no env file, token or other output can be swept in.
# Usage: check-screenshot-uploads.sh [workflow-file]   (default: .github/workflows/ci.yml)
set -euo pipefail
wf="${1:-.github/workflows/ci.yml}"
# Print the `path:` value lines of the upload-artifact step whose `name:` is app-screenshots.
paths="$(awk '
  /^      - / { if (name == "app-screenshots") exit; name = ""; inpath = 0 }
  /^          name: / { name = $2 }
  name == "app-screenshots" && /^          path:/ { inpath = 1; sub(/^          path: *\|?/, ""); if ($0 != "") print; next }
  inpath && /^            / { sub(/^ +/, ""); print; next }
  inpath && /^          [a-z]/ { inpath = 0 }
' "$wf")"
if [ -z "$paths" ]; then
  echo "check-screenshot-uploads: no app-screenshots upload path found in $wf" >&2
  exit 1
fi
if [ "$paths" != "player/mobile/screenshots/*.png" ]; then
  echo "check-screenshot-uploads: app-screenshots must upload exactly player/mobile/screenshots/*.png, got:" >&2
  printf '%s\n' "$paths" >&2
  exit 1
fi
echo "ok app-screenshots uploads only player/mobile/screenshots/*.png"

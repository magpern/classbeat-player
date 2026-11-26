#!/usr/bin/env bash
# Exports the XCTest screenshot attachments named ios-<screen>-<state> from an .xcresult bundle as PNGs (#941),
# so the Designer can review iOS screens the way #878 made Android's available.
# Usage: export-xcresult-screenshots.sh <bundle.xcresult> <out-dir>
# Never fails the job: a missing bundle, a failed export or zero attachments only prints a notice, so it
# cannot hide a test failure (the test step has its own status) or fail a job whose tests passed.
# Only files whose attachment name starts with "ios-" are copied, as <name>.png; nothing else is swept in.
set -uo pipefail
bundle="${1:?bundle.xcresult}"
out="${2:?out-dir}"
mkdir -p "$out"
if [ ! -d "$bundle" ]; then
  echo "::notice::no result bundle at $bundle (the tests may not have started); no iOS screenshots."
  exit 0
fi
raw="$(mktemp -d)"
trap 'rm -rf "$raw"' EXIT
if ! xcrun xcresulttool export attachments --path "$bundle" --output-path "$raw" >&2; then
  echo "::warning::xcresulttool could not export the attachments; no iOS screenshots."
  exit 0
fi
if [ ! -f "$raw/manifest.json" ]; then
  echo "::notice::the export has no manifest; no iOS screenshots."
  exit 0
fi
count=0
# One line per attachment: exported file name, then the human-readable name the test gave it.
while IFS=$'\t' read -r file name; do
  base="$(basename "$name")"
  base="${base%.png}"
  case "$base" in ios-*) ;; *) continue ;; esac
  # Keep only safe name characters; the test's name may carry a suffix such as _0_<uuid>.
  safe="$(printf '%s' "$base" | tr -c 'A-Za-z0-9._-' '_')"
  [ -f "$raw/$file" ] || continue
  cp "$raw/$file" "$out/$safe.png" && count=$((count + 1))
done < <(jq -r '.[].attachments[]? | [.exportedFileName, .suggestedHumanReadableName] | @tsv' "$raw/manifest.json" 2>/dev/null)
if [ "$count" -eq 0 ]; then
  echo "::notice::no ios-* attachments in the result bundle; nothing to upload."
else
  echo "exported $count iOS screenshot(s) to $out"
fi
exit 0

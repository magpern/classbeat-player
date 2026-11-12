#!/usr/bin/env bash
# Lists the Node packages under player/ (or $1/player): every directory with both a
# package.json and a package-lock.json, node_modules excluded. One line per package:
#   <dir> <plain|electron>
# "electron" means package.json depends on electron, so its tests need a display (xvfb).
set -euo pipefail

root="${1:-.}"
[ -d "$root/player" ] || exit 0

while IFS= read -r lock; do
  dir="$(dirname "$lock")"
  [ -f "$dir/package.json" ] || continue
  kind=plain
  if grep -Eq '"electron"[[:space:]]*:' "$dir/package.json"; then
    kind=electron
  fi
  echo "${dir#"$root"/} $kind"
done < <(find "$root/player" -name node_modules -prune -o -name package-lock.json -type f -print | sort)

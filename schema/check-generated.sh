#!/usr/bin/env bash
# Fail if the committed generated types differ from what generate.sh produces now.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

"$here/generate.sh" "$tmp" >/dev/null

if ! diff -ru -x __pycache__ "$here/generated" "$tmp"; then
  echo >&2
  echo "schema/generated is stale. Run schema/generate.sh and commit the result." >&2
  exit 1
fi
echo "schema/generated is up to date."

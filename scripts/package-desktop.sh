#!/usr/bin/env bash
# Packages an UNSIGNED, unnotarized build of the desktop app for the system it runs on: the
# pinned Electron runtime with the built app (player/app/dist) as its app folder, as a .tar.gz.
# No signing, no secrets, no release. Expects `npm ci` and `npm run build` to have run in the app.
# Usage: package-desktop.sh <app-dir> <out-dir> <label>   (label names the file, e.g. linux)
set -euo pipefail

app="${1:?app dir}"
out="${2:?out dir}"
label="${3:?label}"

[ -f "$app/dist/main.cjs" ] || { echo "no $app/dist/main.cjs: run npm run build first" >&2; exit 1; }
[ -d "$app/node_modules/electron/dist" ] || { echo "no Electron runtime: run npm ci first" >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
pkg="$stage/classbeat-player-$label"
mkdir -p "$pkg"
cp -a "$app/node_modules/electron/dist/." "$pkg/"

if [ -d "$pkg/Electron.app" ]; then
  resources="$pkg/Electron.app/Contents/Resources/app"
else
  resources="$pkg/resources/app"
fi
mkdir -p "$resources"
cp -a "$app/dist/." "$resources/dist/"
# The bundle holds everything (the class schema is bundled in), so the app folder needs only
# a manifest pointing at the entry point.
printf '{"name":"classbeat-player","version":"0.0.0","main":"dist/main.cjs"}\n' >"$resources/package.json"

mkdir -p "$out"
tar -czf "$out/classbeat-player-$label-unsigned.tar.gz" -C "$stage" "classbeat-player-$label"
ls -l "$out/classbeat-player-$label-unsigned.tar.gz"

#!/usr/bin/env bash
# Writes per-lane change flags to $GITHUB_OUTPUT (or stdout when unset).
# Env: EVENT (pull_request|push), BASE_SHA (PR base), BEFORE_SHA (push before), HEAD_SHA.
# Anything unknown (new branch, all-zero before, missing commit) counts as "everything changed".
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
head="${HEAD_SHA:-HEAD}"
base=""
case "${EVENT-}" in
  pull_request) base="${BASE_SHA-}" ;;
  push) base="${BEFORE_SHA-}" ;;
  *) ;;
esac

all=0
files=""
if [ -z "$base" ] || [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  all=1
else
  # Pull requests use the merge base (base...head): only what the branch itself changed,
  # not what main gained since. Pushes compare the two tips.
  range="$base $head"
  [ "${EVENT-}" = pull_request ] && range="$base...$head"
  # shellcheck disable=SC2086
  files="$(git diff --name-only $range 2>/dev/null)" || all=1
fi

flag() { # flag <name> <extended regex>
  if [ "$all" -eq 1 ] || printf '%s\n' "$files" | grep -Eq "$2"; then
    echo "$1=true" >>"$out"
  else
    echo "$1=false" >>"$out"
  fi
}

flag backend '^backend/'
flag schema '^schema/'
flag player '^player/'
flag web '^web/'
# Plan section 10: player, web, schema, build and packaging scripts, workflow files,
# dependency manifests and lockfiles.
flag desktop '^(player/|web/|schema/|scripts/(build|package|release)[^/]*|\.github/workflows/|(.*/)?(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt))'

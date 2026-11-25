#!/usr/bin/env bash
# Checks a desktop player release tag before anything is built (issue #760, plan PL7):
#  - the tag is `player-v` followed by a SemVer 2.0.0 version (a pre-release has a hyphen part,
#    for example player-v1.2.0-rc.1);
#  - the tagged commit is on main (an ancestor of, or equal to, <main-ref>).
# Writes version=<X.Y.Z...> and prerelease=<true|false> to $GITHUB_OUTPUT (or stdout when unset).
# Reads only: it never creates, moves or deletes a tag or a branch.
# Usage: check-release-tag.sh <tag> <commit> <main-ref>    (run inside the repository)
set -euo pipefail

tag="${1-}"
commit="${2-}"
main_ref="${3-}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

die() { echo "check-release-tag: $*" >&2; exit 1; }

[ -n "$tag" ] && [ -n "$commit" ] && [ -n "$main_ref" ] ||
  die "usage: check-release-tag.sh <tag> <commit> <main-ref>"

# SemVer 2.0.0 (semver.org), written as a POSIX extended regex: no leading zeros in numbers or
# numeric pre-release identifiers; identifiers are [0-9A-Za-z-], dot-separated and not empty.
num='(0|[1-9][0-9]*)'
pre_id='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
build_id='[0-9A-Za-z-]+'
pre="-${pre_id}(\.${pre_id})*"
build="\+${build_id}(\.${build_id})*"
re="^player-v${num}\.${num}\.${num}(${pre})?(${build})?$"

[[ "$tag" =~ $re ]] || die "not a release tag (expected player-vX.Y.Z, SemVer): $tag"
version="${tag#player-v}"

# The pre-release part is the hyphen after the core X.Y.Z, before any +build part.
core_and_pre="${version%%+*}"
if [[ "$core_and_pre" == *-* ]]; then prerelease=true; else prerelease=false; fi

git cat-file -e "$commit^{commit}" 2>/dev/null || die "unknown commit: $commit"
git cat-file -e "$main_ref^{commit}" 2>/dev/null || die "unknown main ref: $main_ref (fetch main first)"
git merge-base --is-ancestor "$commit" "$main_ref" || die "the tagged commit $commit is not on main ($main_ref)"

{
  echo "version=$version"
  echo "prerelease=$prerelease"
} >>"$out"
echo "check-release-tag: ok: $tag (version $version, prerelease $prerelease) is on main" >&2

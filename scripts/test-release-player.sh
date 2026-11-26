#!/usr/bin/env bash
# Tests the desktop player release (issue #760): scripts/check-release-tag.sh against a throwaway
# git repository, scripts/release-player-assets.sh on fake archives, and static checks of
# .github/workflows/release-player.yml (pinned actions, no secrets, least privilege, timeouts,
# nothing published from a pull request, no tag moved or deleted; #783: build needs verify,
# publish's guard is all &&, no pull_request_target, SHA256SUMS and the remote tag checked before
# publishing). Touches no network.
# The workflow checks are functions that wf_check calls by name, which shellcheck cannot see.
# The patterns quote workflow text such as ${{ github.sha }} and $COMMIT literally.
# shellcheck disable=SC2329,SC2016
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
wf="$root/.github/workflows/release-player.yml"
fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

ok() { echo "ok: $*"; }
bad() { echo "FAIL: $*"; fail=1; }

# --- check-release-tag.sh ------------------------------------------------------------------------
repo="$tmp/repo"
git init -q -b main "$repo"
g() { git -C "$repo" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false "$@"; }
g commit -q --allow-empty -m one
first="$(g rev-parse HEAD)"
g commit -q --allow-empty -m two
on_main="$(g rev-parse HEAD)"
g checkout -q -b side
g commit -q --allow-empty -m side
off_main="$(g rev-parse HEAD)"
g checkout -q main

tag_check() { # tag_check <pass|fail> <tag> <commit> [want-version want-prerelease]
  local want="$1" tag="$2" commit="$3" rc=0 out="$tmp/out"
  : >"$out"
  (cd "$repo" && GITHUB_OUTPUT="$out" bash "$here/check-release-tag.sh" "$tag" "$commit" main) >/dev/null 2>&1 || rc=$?
  if [ "$want" = pass ]; then
    if [ "$rc" -ne 0 ]; then bad "tag '$tag' refused (expected pass)"; return; fi
    if ! grep -qx "version=$4" "$out" || ! grep -qx "prerelease=$5" "$out"; then
      bad "tag '$tag' wrote: $(tr '\n' ' ' <"$out")"
      return
    fi
  elif [ "$rc" -eq 0 ]; then
    bad "tag '$tag' at ${commit:0:7} accepted (expected fail)"
    return
  elif [ -s "$out" ]; then
    bad "tag '$tag' wrote outputs although it failed"
    return
  fi
  ok "tag '$tag' $want"
}

tag_check pass player-v1.2.3 "$on_main" 1.2.3 false
tag_check pass player-v0.1.0 "$first" 0.1.0 false
tag_check pass player-v1.2.3-rc.1 "$on_main" 1.2.3-rc.1 true
tag_check pass player-v2.0.0-alpha "$on_main" 2.0.0-alpha true
tag_check pass player-v1.0.0+build.5 "$on_main" 1.0.0+build.5 false
tag_check pass player-v1.0.0+build-5 "$on_main" 1.0.0+build-5 false
tag_check pass player-v1.0.0-rc.1+b7 "$on_main" 1.0.0-rc.1+b7 true
# Not SemVer, or not a player tag.
tag_check fail player-v1.2 "$on_main"
tag_check fail player-v1.2.3.4 "$on_main"
tag_check fail v1.2.3 "$on_main"
tag_check fail player-1.2.3 "$on_main"
tag_check fail player-v01.2.3 "$on_main"
tag_check fail player-v1.02.3 "$on_main"
tag_check fail player-v1.2.3-01 "$on_main"
tag_check fail player-v1.2.3- "$on_main"
tag_check fail player-v1.2.3-rc..1 "$on_main"
tag_check fail player-v1.2.3+ "$on_main"
tag_check fail "player-v1.2.3 " "$on_main"
tag_check fail 'player-v1.2.3;id' "$on_main"
tag_check fail player-vX.Y.Z "$on_main"
tag_check fail "" "$on_main"
# SemVer, but the commit is not on main, or is unknown.
tag_check fail player-v1.2.3 "$off_main"
tag_check fail player-v1.2.3 0000000000000000000000000000000000000000

# --- release-player-assets.sh --------------------------------------------------------------------
assets() { # assets <dir> -> rc
  bash "$here/release-player-assets.sh" "$1" 1.2.3 >/dev/null 2>&1
}
make_set() { # make_set <dir> <targets...>
  local d="$1" t
  shift
  mkdir -p "$d"
  for t in "$@"; do printf 'archive %s\n' "$t" >"$d/classbeat-player-$t-unsigned.tar.gz"; done
}
all_targets=(linux-x64 macos-arm64 macos-x64 windows-x64)

make_set "$tmp/a1" "${all_targets[@]}"
if assets "$tmp/a1" &&
  [ "$(wc -l <"$tmp/a1/SHA256SUMS")" -eq 4 ] &&
  (cd "$tmp/a1" && sha256sum -c --quiet SHA256SUMS) &&
  grep -q 'unsigned and unnotarized' "$tmp/a1/RELEASE_NOTES.md" &&
  grep -q '1.2.3' "$tmp/a1/RELEASE_NOTES.md"; then
  ok "assets: SHA256SUMS for four archives and unsigned release notes"
else
  bad "assets: complete set"
fi

# The notes promise no APK (#853): android-sign may still fail after they are written, so the app is
# mentioned only in the conditional last paragraph. A keyword filter misses a promise worded another
# way ("phone app", "mobile build"), so the whole file is the allowlist: every line is exactly this
# text, and any change to the notes is a change to this test (#862).
notes_want="$(cat <<'WANT'
## classbeat player 1.2.3

**These builds are unsigned and unnotarized.** Code signing and macOS notarisation are not set up
yet, so macOS Gatekeeper and Windows SmartScreen warn when the app is opened.

| System | File |
|---|---|
| Linux x64 | `classbeat-player-linux-x64-unsigned.tar.gz` |
| macOS, Apple silicon | `classbeat-player-macos-arm64-unsigned.tar.gz` |
| macOS, Intel | `classbeat-player-macos-x64-unsigned.tar.gz` |
| Windows x64 | `classbeat-player-windows-x64-unsigned.tar.gz` |

Check a download against `SHA256SUMS`: `sha256sum -c SHA256SUMS --ignore-missing`.

The signed Android app is attached separately, only after it has been signed and verified. If this
release lists `classbeat-player-android.apk`, check it against `SHA256SUMS-android`; if it does
not, this release has no Android app.
WANT
)"
if printf '%s\n' "$notes_want" | cmp -s - "$tmp/a1/RELEASE_NOTES.md"; then
  ok "assets: the release notes are exactly the allowed text, the app mentioned only conditionally"
else
  bad "assets: the release notes differ from the allowed text: $(printf '%s\n' "$notes_want" | diff - "$tmp/a1/RELEASE_NOTES.md" | head -5)"
fi

make_set "$tmp/a2" linux-x64 macos-arm64 windows-x64
if assets "$tmp/a2"; then bad "assets: a missing target was accepted"; else ok "assets: missing target refused"; fi

make_set "$tmp/a3" "${all_targets[@]}"
echo x >"$tmp/a3/extra.txt"
if assets "$tmp/a3"; then bad "assets: an unexpected file was accepted"; else ok "assets: unexpected file refused"; fi

make_set "$tmp/a4" "${all_targets[@]}"
: >"$tmp/a4/classbeat-player-macos-x64-unsigned.tar.gz"
if assets "$tmp/a4"; then bad "assets: an empty archive was accepted"; else ok "assets: empty archive refused"; fi

# --- the workflow --------------------------------------------------------------------------------
wf_check() { # wf_check <description> <command...>: the command must succeed
  local what="$1"
  shift
  if "$@"; then ok "workflow: $what"; else bad "workflow: $what"; fi
}
uses_pinned() { ! grep -E '^\s*-?\s*uses:' "$wf" | grep -Evq 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40} # v[0-9]'; }
# The Android signing secrets (#849) are the only secrets, and only in android-sign
# (scripts/test-sign-android-apk.sh checks that job); no other job references one.
no_secrets() {
  awk '/^  android-sign:$/{s=1; next} /^  [A-Za-z0-9_-]+:$/{s=0} !s' "$wf" >"$tmp/not-sign"
  ! grep -q 'secrets\.' "$tmp/not-sign"
}
top_read_only() { awk '/^permissions:/{getline; print; exit}' "$wf" | grep -qx '  contents: read'; }
# contents: write is in publish and publish-android only (#849), once each.
one_write() {
  local j
  [ "$(grep -c 'contents: write' "$wf")" -eq 2 ] || return 1
  for j in publish publish-android; do
    job_block "$j" && grep -q 'contents: write' "$tmp/job-$j" || return 1
  done
}
# Each job (two-space key under jobs:) has its own timeout-minutes (#756).
all_timeouts() {
  local jobs timeouts
  jobs="$(awk '/^jobs:/{j=1; next} j && /^  [A-Za-z0-9_-]+:$/' "$wf" | wc -l)"
  timeouts="$(grep -cE '^    timeout-minutes: [0-9]+$' "$wf")"
  [ "$jobs" -ge 4 ] && [ "$jobs" -eq "$timeouts" ]
}
# The only job with write access publishes, and only on a tag push or a non-dry-run dispatch on a tag.
publish_guarded() {
  awk '/^  publish:$/{p=1; next} p && /^  [A-Za-z0-9_-]+:$/{exit} p' "$wf" >"$tmp/publish"
  grep -q "github.event_name != 'pull_request'" "$tmp/publish" &&
    grep -q "needs.verify.outputs.publish == 'true'" "$tmp/publish" &&
    grep -q "startsWith(github.ref, 'refs/tags/player-v')" "$tmp/publish" &&
    grep -q 'contents: write' "$tmp/publish" &&
    grep -q -- '--verify-tag' "$tmp/publish"
}
# The block of one job (two-space key under jobs:) into $tmp/job-<name>.
job_block() {
  awk -v j="  $1:" '$0 == j {p=1; next} p && /^  [A-Za-z0-9_-]+:$/{exit} p' "$wf" >"$tmp/job-$1"
  [ -s "$tmp/job-$1" ]
}
# No build starts before verify has checked the tag (#783).
build_needs_verify() {
  job_block build && grep -Eq '^    needs: (verify|\[([a-z_-]+, )*verify(, [a-z_-]+)*\])$' "$tmp/job-build"
}
# publish's if: is one line of conditions all joined with &&: no ||, no negated group, and each
# required condition is one of its terms (#783).
publish_if_and_only() {
  local cond term need found
  job_block publish || return 1
  [ "$(grep -c '^    if: ' "$tmp/job-publish")" -eq 1 ] || return 1
  cond="$(sed -n 's/^    if: //p' "$tmp/job-publish")"
  case "$cond" in *'||'* | *'!('*) return 1 ;; esac
  for need in "needs.verify.outputs.publish == 'true'" "github.event_name != 'pull_request'" \
    "startsWith(github.ref, 'refs/tags/player-v')"; do
    found=0
    while IFS= read -r term; do
      term="$(sed -E 's/^ +| +$//g' <<<"$term")"
      if [ "$term" = "$need" ]; then found=1; fi
    done <<<"${cond//&&/$'\n'}"
    [ "$found" -eq 1 ] || return 1
  done
}
# No trigger that runs with write access on a pull request's code (#783).
no_pr_target() { ! grep -q 'pull_request_target' "$wf"; }
# publish runs <pattern> in a step before gh release create.
before_release() {
  local at rel
  job_block publish || return 1
  at="$(grep -nE -- "$1" "$tmp/job-publish" | head -n1 | cut -d: -f1)"
  rel="$(grep -n 'gh release create' "$tmp/job-publish" | head -n1 | cut -d: -f1)"
  [ -n "$at" ] && [ -n "$rel" ] && [ "$at" -lt "$rel" ]
}
# publish checks the downloaded archives against SHA256SUMS before uploading them (#783).
publish_checks_sums() { before_release '^ +sha256sum -c --strict SHA256SUMS$'; }
# publish checks that the remote tag still points at the built commit, and fails if not (#783).
publish_checks_tag() {
  before_release 'git ls-remote "\$REPO_URL" "refs/tags/\$TAG"' &&
    grep -q '^          COMMIT: \${{ github.sha }}$' "$tmp/job-publish" &&
    grep -A3 'if \[ "\$remote" != "\$COMMIT" \]; then' "$tmp/job-publish" | grep -q '^ *exit 1$'
}
# Nothing creates, moves or deletes a tag or a release, or pushes; no shell tracing that could echo values.
no_tag_changes() { ! grep -Eq 'git (push|tag)|--delete|release (delete|edit)|--clobber|set -x|--force' "$wf"; }
# Values a pusher controls reach scripts only through env:, never pasted into a run: script.
no_injection() {
  ! grep -E 'github\.(ref_name|ref|head_ref|event\.)|inputs\.' "$wf" |
    grep -Evq '^\s+[A-Z_]+: \$\{\{[^}]*\}\}$|^\s+if: |^\s+group: |^\s+cancel-in-progress: '
}

wf_check "exists" test -f "$wf"
wf_check "every action is pinned to a full commit SHA" uses_pinned
wf_check "references no secret outside android-sign" no_secrets
wf_check "top-level permissions are contents: read" top_read_only
wf_check "contents: write only in publish and publish-android" one_write
wf_check "every job has a timeout" all_timeouts
wf_check "publish is guarded and uses --verify-tag" publish_guarded
wf_check "never moves or deletes a tag, never traces" no_tag_changes
wf_check "build needs verify" build_needs_verify
wf_check "publish's if: joins its conditions with &&" publish_if_and_only
wf_check "no pull_request_target trigger" no_pr_target
wf_check "publish checks SHA256SUMS before uploading" publish_checks_sums
wf_check "publish checks the remote tag still points at github.sha" publish_checks_tag
wf_check "untrusted values pass through env only" no_injection

exit "$fail"

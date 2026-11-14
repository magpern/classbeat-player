#!/usr/bin/env bash
# The web lane's checks, for CI (and `npm test`): lint, types, build, unit tests, then the specs'
# measurable checks in headless Chrome: the room screen (docs/design/room-2d.md, C1 to C9) at every
# state and size, with screenshots in screenshots/, and the website (docs/design/site.md, S1 to
# S12) at every state, size and at 200 % text, on a fake backend, with screenshots in
# screenshots/site/, and the web player page /play (docs/design/play.md, P1 to P10, and the picker with
# the website's checks) at every state and size on a fake backend, with screenshots in screenshots/play/,
# its request, banned-API and shared-clock-surface guards (ADR 0008). Expects `npm ci` to have run.
# SPEC_ONLY=<regex> limits the screenshot checks to matching "<fixture>-<w>x<h>" or
# "site-<state>-<w>" names.
#
# Usage (the CI `web` job and `web-specs` shards call the parts, issue #435):
#   bash ci.sh           everything, one after the other: what `npm test` runs locally
#   bash ci.sh static    lint, types, build, unit tests and the shard check (the `web` job)
#   bash ci.sh check     only the shard check: every spec file is in exactly one shard (spec-shards.txt)
#   bash ci.sh shard <n> build, then the spec files of shard <n> of spec-shards.txt (a `web-specs` leg)
# Concurrency between spec files stays 1 everywhere, so screenshots do not suffer from CPU contention.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

MANIFEST=spec-shards.txt
NODE_TEST=(node --import tsx --test --test-concurrency=1 --test-timeout=3000000)

# Prints the manifest's lines: "<shard>;<file>;<part>" ("" part for a whole file).
manifest_lines() {
  local shard file part
  while read -r shard file part; do
    [ -z "${shard:-}" ] && continue
    case "$shard" in \#*) continue ;; esac
    printf '%s;%s;%s\n' "$shard" "$file" "${part:-}"
  done <"$MANIFEST"
}

# Fails when a spec file is in no shard, a whole file is listed twice or next to parts, a part is
# listed twice, a split has no single `*` part, a shard number is out of range or a name is no file.
check_shards() {
  local bad=0 on_disk listed shard file part f
  on_disk="$(cd test/spec && find . -maxdepth 1 -name '*.test.ts' | sed 's|^\./||' | sort)"
  listed="$(manifest_lines | cut -d';' -f2 | sort -u)"
  while IFS=';' read -r shard file part; do
    case "$shard" in 1 | 2 | 3 | 4 | 5) ;; *) echo "spec-shards: bad shard '$shard' for $file" >&2; bad=1 ;; esac
    [ -f "test/spec/$file" ] || { echo "spec-shards: $file is not a spec file in test/spec/" >&2; bad=1; }
  done < <(manifest_lines)
  while read -r f; do
    [ -z "$f" ] && continue
    if ! grep -qxF "$f" <<<"$listed"; then echo "spec-shards: $f is in no shard" >&2; bad=1; fi
  done <<<"$on_disk"
  while read -r f; do
    [ -z "$f" ] && continue
    local whole parts stars dupes
    whole="$(manifest_lines | awk -F';' -v f="$f" '$2==f && $3==""' | wc -l)"
    parts="$(manifest_lines | awk -F';' -v f="$f" '$2==f && $3!=""' | wc -l)"
    stars="$(manifest_lines | awk -F';' -v f="$f" '$2==f && $3=="*"' | wc -l)"
    dupes="$(manifest_lines | awk -F';' -v f="$f" '$2==f && $3!=""{print $3}' | sort | uniq -d | wc -l)"
    if [ "$whole" -gt 1 ] || { [ "$whole" -ge 1 ] && [ "$parts" -ge 1 ]; }; then
      echo "spec-shards: $f is in more than one shard" >&2; bad=1
    elif [ "$parts" -ge 1 ] && { [ "$parts" -lt 2 ] || [ "$stars" -ne 1 ] || [ "$dupes" -ne 0 ]; }; then
      echo "spec-shards: $f is split wrongly (two or more distinct parts and exactly one '*')" >&2; bad=1
    fi
  done <<<"$listed"
  [ "$bad" -eq 0 ] || return 1
  echo "spec-shards: $(wc -l <<<"$on_disk" | tr -d ' ') spec files, each in exactly one shard"
  # site-checks' own "covers every state" test returns early under SPEC_ONLY, so it is checked here.
  local site_parts=()
  while read -r part; do site_parts+=("$part"); done < <(manifest_lines | awk -F';' '$2=="site-checks.test.ts" && $3!=""{print $3}')
  if [ "${#site_parts[@]}" -gt 0 ]; then
    node --import tsx test/lib/check-site-shards.ts "${site_parts[@]}"
  fi
}

# The SPEC_ONLY regex of the part "*": every shot none of the file's other parts takes.
rest_regex() { # rest_regex <file>
  local others="" p
  while read -r p; do
    [ -z "$p" ] && continue
    others="${others:+$others|}.*(?:$p)"
  done < <(manifest_lines | awk -F';' -v f="$1" '$2==f && $3!="" && $3!="*"{print $3}')
  printf '^(?!%s)' "$others"
}

run_shard() { # run_shard <n>
  local n="$1" status=0 whole=() shard file part
  npm run build
  while IFS=';' read -r shard file part; do
    [ "$shard" = "$n" ] || continue
    if [ -z "$part" ]; then
      whole+=("test/spec/$file")
    else
      [ "$part" = "*" ] && part="$(rest_regex "$file")"
      echo "== $file, shots matching $part"
      SPEC_ONLY="$part" "${NODE_TEST[@]}" "test/spec/$file" || status=1
    fi
  done < <(manifest_lines)
  if [ "${#whole[@]}" -gt 0 ]; then
    echo "== ${#whole[@]} whole spec files"
    "${NODE_TEST[@]}" "${whole[@]}" || status=1
  fi
  return "$status"
}

static_checks() {
  npm run lint
  npm run typecheck
  npm run build
  npm run test:unit
  check_shards
}

case "${1:-all}" in
  all)
    static_checks
    "${NODE_TEST[@]}" "test/spec/*.test.ts"
    ;;
  static) static_checks ;;
  check) check_shards ;;
  shard)
    check_shards
    run_shard "${2:?usage: ci.sh shard <1-5>}"
    ;;
  *)
    echo "usage: ci.sh [all|static|check|shard <n>]" >&2
    exit 2
    ;;
esac

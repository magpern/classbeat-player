#!/usr/bin/env bash
# Provider guard (ADR 0004, sections 2, 4, 5 and 7). Fails if a tracked file names a forbidden
# provider host, or a forbidden package in a dependency manifest, a lockfile or an import.
# The list is scripts/provider-guard.txt. Allowed places: docs/, AGENTS.md, README.md at the
# root, and the list itself. A "name" entry is narrower: it is forbidden in every tracked file
# except the list itself and the one ADR named below (ADR 0004, section 4). Run from anywhere
# inside the repository.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
list="scripts/provider-guard.txt"
[ -f "$list" ] || { echo "check-providers: missing $list" >&2; exit 2; }

allowed=(':(top,exclude)docs' ':(top,exclude)AGENTS.md' ':(top,exclude)README.md' ":(top,exclude)$list")
# Where a "name" entry may appear: the list (above) and ADR 0004, nowhere else.
name_allowed=(":(top,exclude)$list" ':(top,exclude)docs/adr/0004-provider-terms.md')
manifests=(
  ':(glob)**/package.json' ':(glob)**/package-lock.json' ':(glob)**/npm-shrinkwrap.json'
  ':(glob)**/yarn.lock' ':(glob)**/pnpm-lock.yaml' ':(glob)**/requirements*.txt'
  ':(glob)**/pyproject.toml' ':(glob)**/poetry.lock' ':(glob)**/uv.lock' ':(glob)**/Pipfile*'
  ':(glob)**/Cargo.toml' ':(glob)**/Cargo.lock' ':(glob)**/go.mod' ':(glob)**/go.sum'
  ':(glob)**/Gemfile*' ':(glob)**/*.csproj' ':(glob)**/packages.config'
)
status=0
count=0

report() { # report <what> <git grep -n output>; prints file:line, never the line text
  [ -n "$2" ] || return 0
  while IFS=: read -r file lineno _; do
    echo "forbidden ($1): $file:$lineno"
  done <<<"$2"
  status=1
}

while read -r kind value extra; do
  case "$kind" in
    '' | '#'*) continue ;;
  esac
  if [ -z "${value:-}" ] || [ -n "${extra:-}" ]; then
    echo "check-providers: bad line in $list: $kind $value ${extra:-}" >&2
    exit 2
  fi
  esc="$(printf '%s' "$value" | sed -E 's#([].[*^$\\+?(){}|])#\\\1#g')"
  count=$((count + 1))
  case "$kind" in
    host)
      # The host or a subdomain of it; not a longer name that merely ends the same way.
      found="$(git grep -I -i -n -E -e "(^|[^A-Za-z0-9.-])([A-Za-z0-9-]+\\.)*${esc}([^A-Za-z0-9-]|\$)" -- . "${allowed[@]}" || true)"
      report "host $value" "$found"
      ;;
    package)
      found="$(git grep -I -i -n -E -e "(^|[^A-Za-z0-9._@/-]|node_modules/|^[[:space:]]*/)${esc}([^A-Za-z0-9._-]|\$)" -- "${manifests[@]}" "${allowed[@]}" || true)"
      report "package $value in a manifest" "$found"
      found="$(git grep -I -i -n -E -e "(import|from|require\\(?|use)[[:space:](\"']*${esc}([^A-Za-z0-9._-]|\$)" -- . "${allowed[@]}" || true)"
      report "package $value imported" "$found"
      ;;
    name)
      # Case-insensitive; a "-" in the value stands for any run of non-alphanumerics, so
      # "a-b" matches "a b", "a_b" and "ab".
      pat="$(printf '%s' "$esc" | sed -E 's#-#[^A-Za-z0-9]*#g')"
      # -a: binary files are searched too (a name inside an image or an archive is still a name).
      found="$(git grep -a -i -n -E -e "$pat" -- . "${name_allowed[@]}" | tr -d "\\000" || true)"
      report "name $value" "$found"
      # File and directory names too. Only the path is printed, as with a content match.
      pathfound="$(git ls-files -z -- . "${name_allowed[@]}" | tr "\\n\\0" " \\n" | grep -i -E -e "$pat" || true)"
      if [ -n "$pathfound" ]; then
        while IFS= read -r file; do
          echo "forbidden (name $value in a path): $file"
        done <<<"$pathfound"
        status=1
      fi
      ;;
    *)
      echo "check-providers: unknown kind '$kind' in $list" >&2
      exit 2
      ;;
  esac
done <"$list"

[ "$count" -gt 0 ] || { echo "check-providers: $list has no entries" >&2; exit 2; }
if [ "$status" -eq 0 ]; then
  echo "check-providers: ok ($count entries)"
fi
exit "$status"

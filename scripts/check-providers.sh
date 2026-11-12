#!/usr/bin/env bash
# Provider guard (ADR 0004, sections 2, 4, 5 and 7). Fails if a tracked file names a forbidden
# provider host, or a forbidden package in a dependency manifest, a lockfile or an import.
# The list is scripts/provider-guard.txt. Allowed places: docs/, AGENTS.md, README.md at the
# root, and the list itself. Run from anywhere inside the repository.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
list="scripts/provider-guard.txt"
[ -f "$list" ] || { echo "check-providers: missing $list" >&2; exit 2; }

allowed=(':(top,exclude)docs' ':(top,exclude)AGENTS.md' ':(top,exclude)README.md' ":(top,exclude)$list")
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
      found="$(git grep -I -i -n -E -e "(^|[^A-Za-z0-9._@/-]|node_modules/)${esc}([^A-Za-z0-9._-]|\$)" -- "${manifests[@]}" "${allowed[@]}" || true)"
      report "package $value in a manifest" "$found"
      found="$(git grep -I -i -n -E -e "(import|from|require\\(?|use)[[:space:](\"']*${esc}([^A-Za-z0-9._-]|\$)" -- . "${allowed[@]}" || true)"
      report "package $value imported" "$found"
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

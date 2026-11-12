#!/usr/bin/env bash
# Fails if a tracked file must never be committed: .env files (except .env.example),
# anything under secrets/, or a private key. Run from anywhere inside the repository.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
status=0

while IFS= read -r -d '' f; do
  base="${f##*/}"
  case "$f" in
    secrets/* | */secrets/*)
      echo "forbidden: tracked file under secrets/: $f"
      status=1
      ;;
  esac
  case "$base" in
    .env.example) ;;
    .env | .env.*)
      echo "forbidden: tracked env file: $f"
      status=1
      ;;
  esac
done < <(git ls-files -z)

keys="$(git grep -I -l -E -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . ':(exclude)scripts/test-check-repo.sh' || true)"
if [ -n "$keys" ]; then
  while IFS= read -r f; do
    echo "forbidden: private key material in: $f"
  done <<<"$keys"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "check-repo: ok"
fi
exit "$status"

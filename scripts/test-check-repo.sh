#!/usr/bin/env bash
# Tests scripts/check-repo.sh in throwaway git repositories.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0

new_repo() {
  rm -rf "$tmp/r"
  mkdir -p "$tmp/r/scripts"
  cp "$here/check-repo.sh" "$tmp/r/scripts/check-repo.sh"
  git -C "$tmp/r" init -q
  echo hello >"$tmp/r/README.md"
}

expect() { # expect <pass|fail> <name>
  local want="$1" name="$2" rc=0
  git -C "$tmp/r" add -A
  (cd "$tmp/r" && bash scripts/check-repo.sh >/dev/null 2>&1) || rc=$?
  if { [ "$want" = pass ] && [ "$rc" -ne 0 ]; } || { [ "$want" = fail ] && [ "$rc" -eq 0 ]; }; then
    echo "FAIL: $name (expected $want, exit $rc)"
    fail=1
  else
    echo "ok: $name"
  fi
}

new_repo
expect pass "clean tree"

new_repo
echo A=1 >"$tmp/r/.env"
expect fail ".env tracked"

new_repo
echo A=1 >"$tmp/r/.env.production"
expect fail ".env.production tracked"

new_repo
mkdir -p "$tmp/r/app"
echo A=1 >"$tmp/r/app/.env.local"
expect fail "nested .env.local tracked"

new_repo
echo A=changeme >"$tmp/r/.env.example"
expect pass ".env.example allowed"

new_repo
mkdir -p "$tmp/r/secrets"
echo x >"$tmp/r/secrets/token.txt"
expect fail "file under secrets/"

new_repo
printf -- '-----BEGIN %s PRIVATE KEY-----\nabc\n' RSA >"$tmp/r/key.pem"
expect fail "RSA private key"

new_repo
printf -- '-----BEGIN %s PRIVATE KEY-----\nabc\n' OPENSSH >"$tmp/r/id"
expect fail "OpenSSH private key"

new_repo
printf -- '-----BEGIN %s-----\nabc\n' "PUBLIC KEY" >"$tmp/r/pub.pem"
expect pass "public key allowed"

exit "$fail"

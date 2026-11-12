#!/usr/bin/env bash
# Everything the backend lane checks: install from the lockfile, lint, format, types, tests.
# The infra lane's CI job only calls this.
#
# Database: the tests need a throwaway PostgreSQL 17 and its superuser URL in
# PLAYER_TEST_DATABASE_URL (for example a `postgres:17` service container:
# postgresql://postgres:<password>@127.0.0.1:5432/postgres). The tests drop and create the roles
# player_owner, player_app and player_auth and the database player_test on it, so never point it
# at a server that holds anything. Without the variable this script fails.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

if [ -z "${PLAYER_TEST_DATABASE_URL:-}" ]; then
  echo "backend/ci.sh: PLAYER_TEST_DATABASE_URL is required (see the comment at the top)" >&2
  exit 2
fi
# The database tests fail instead of skipping.
export PLAYER_REQUIRE_DATABASE=1

echo "== install (lockfile) =="
uv sync --locked

echo "== lint, format, types =="
uv run --locked ruff check .
uv run --locked ruff format --check .
uv run --locked pyright

echo "== tests =="
uv run --locked pytest -q

echo "backend/ci.sh: all checks passed"

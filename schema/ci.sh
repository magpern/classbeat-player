#!/usr/bin/env bash
# Everything the contract lane checks: install from lockfiles, generated types up to date,
# Python lint/types/tests, TypeScript types/tests. The infra lane's CI job only calls this.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== install (lockfiles) =="
uv sync --project "$here/python" --frozen
npm --prefix "$here/ts" ci --no-audit --no-fund

echo "== generated types are current =="
"$here/check-generated.sh"

echo "== python: lint, types, tests =="
uv run --project "$here/python" --frozen ruff check "$here/python"
uv run --project "$here/python" --frozen ruff format --check "$here/python"
(cd "$here/python" && uv run --frozen pyright)
uv run --project "$here/python" --frozen pytest -q "$here/python"

echo "== typescript: types, tests =="
npm --prefix "$here/ts" run typecheck
npm --prefix "$here/ts" test

echo "schema/ci.sh: all checks passed"

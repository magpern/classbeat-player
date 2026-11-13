#!/usr/bin/env bash
# The web lane's checks, for CI (and `npm test`): lint, types, build, unit tests, then the spec's
# measurable checks (docs/design/room-2d.md, C1 to C9) on the real screen in headless Chrome at
# every state and size, with screenshots written to screenshots/. Expects `npm ci` to have run.
# SPEC_ONLY=<regex> limits the screenshot checks to matching "<fixture>-<w>x<h>" names.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

npm run lint
npm run typecheck
npm run build
npm run test:unit
node --import tsx --test --test-concurrency=1 --test-timeout=3000000 "test/spec/*.test.ts"

#!/usr/bin/env bash
# The player app's checks, for the infra lane to call (and `npm test`): lint, types, unit tests,
# then the Electron e2e test. The e2e test needs a display; on headless Linux run this under
# xvfb-run (the node-packages CI job does). Expects `npm ci` to have run.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e

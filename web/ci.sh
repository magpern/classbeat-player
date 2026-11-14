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
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

npm run lint
npm run typecheck
npm run build
npm run test:unit
node --import tsx --test --test-concurrency=1 --test-timeout=3000000 "test/spec/*.test.ts"

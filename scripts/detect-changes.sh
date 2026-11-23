#!/usr/bin/env bash
# Writes per-lane change flags to $GITHUB_OUTPUT (or stdout when unset).
# Env: EVENT (pull_request|push), BASE_SHA (PR base), BEFORE_SHA (push before), HEAD_SHA.
# Anything unknown (new branch, all-zero before, missing commit) counts as "everything changed".
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
head="${HEAD_SHA:-HEAD}"
base=""
case "${EVENT-}" in
  pull_request) base="${BASE_SHA-}" ;;
  push) base="${BEFORE_SHA-}" ;;
  *) ;;
esac

all=0
files=""
if [ -z "$base" ] || [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  all=1
else
  # Pull requests use the merge base (base...head): only what the branch itself changed,
  # not what main gained since. Pushes compare the two tips.
  range="$base $head"
  [ "${EVENT-}" = pull_request ] && range="$base...$head"
  # --no-renames lists both paths of a rename, so moving web/a.ts to docs/a.ts is not docs-only (#438).
  # shellcheck disable=SC2086
  files="$(git diff --no-renames --name-only $range 2>/dev/null)" || all=1
fi

# A change that touches only documentation runs no tests (issue #435, owner 2026-11-14): every
# changed path is under docs/ (including docs/design/ and its mock-ups) or is a root *.md file.
# Then every flag below is false. `code` says that something other than documentation changed; it
# gates the script tests, deploy-file tests and shellcheck in repo-checks. scripts/check-repo.sh
# (the never-commit guard) and the pr-title check do not depend on it and always run.
docs_only=0
if [ "$all" -eq 0 ] && [ -n "$files" ] && ! printf '%s\n' "$files" | grep -Evq '^(docs/|[^/]+\.md$)'; then
  docs_only=1
fi

flag() { # flag <name> <extended regex>
  if [ "$docs_only" -eq 1 ]; then
    echo "$1=false" >>"$out"
  elif [ "$all" -eq 1 ] || printf '%s\n' "$files" | grep -Eq "$2"; then
    echo "$1=true" >>"$out"
  else
    echo "$1=false" >>"$out"
  fi
}

# A workflow change also runs the backend, schema and player jobs, so a change to CI itself is exercised.
# The backend also depends on schema/ (the class format and the path dependency schema/python).
flag backend '^(backend/|schema/|\.github/workflows/)'
flag schema '^(schema/|\.github/workflows/)'
# The scene reads files outside player/: web/src/design/tokens.css (player/scene/render/tools/tokens-file.ts and
# test/tokens-light.test.ts read it) and web/src/design/fonts/ (player/scene/render/build.mjs copies both into the demo).
# A change to only those files must run the scene tests, or main can go red unseen (#579).
# The player's room window bundles the plain 2D screen: player/app/src/renderer/room.ts imports web/src/main.ts
# (so all of web/src/), player/app/test/shots/room-page.ts imports web/src/fixtures/, and room-measure.ts imports
# web/test/spec/page/{collect,ink}.js. A change to any of those must run the player job (#579).
flag player '^(player/|\.github/workflows/|scripts/package-desktop\.sh|web/src/|web/test/spec/page/)'
# The Android spike's APK bundles the scene demo (player/scene/render) and its tokens.css and fonts, so a change
# there rebuilds it too (#558, #579).
flag android '^(player/spikes/android-follower/|player/scene/render/|web/src/design/(tokens\.css|fonts/)|\.github/workflows/)'
# The web tests also read files outside web/: the design specs and mock-ups under docs/design/
# (docs/design/mockups/tokens.css is compared with web/src/design/tokens.css, the checks are ported
# from docs/design/mockups/*.js), the live-session schema and examples under schema/live/, and
# backend/src/player_backend/request_policy.py (the fake's CSP is checked against it).
# web/test/unit/companion-fake-headers.test.ts reads backend/tests/test_control_page.py (the
# control page's header table), so a backend PR that changes only that file must run the web job (#347).
# web/test/lib/rider-policy.ts and its control equivalent read backend/src/player_backend/
# rider_page_policy.py and control_page_policy.py, so a backend-only change to either runs the web job (#375).
# The browser page imports player/app/src/core/clock/{clock,plan,view}.ts, the shared clock surface, so a
# change to any of those three files runs the web job (ADR 0008 section 4, #391). The rest of core/clock/ is not shared.
# It also imports player/scene/model/src/flash-marks.ts, the pure flash scheduler (#604), which the backend image's
# web stage copies by name; a change to that one file runs the web job.
# A change there must run the whole web job, or main can go red unseen (issue #268).
# docs/design/ is NOT in the list any more (issue #435, owner 2026-11-14): documentation alone runs no
# tests. A mismatch between a mock-up or spec in docs/design/ (for example mockups/tokens.css) and the
# product, which #268 would have caught in the pull request that changed it, now shows on the next
# change that touches web/ (or another file below). A pull request that changes docs/design/ together
# with other code still runs whatever that code needs, but not web only because of docs/design/.
# player/app/src/core/** and schema/generated/ts are already covered by the drift-only step,
# through the player and schema flags.
flag web '^(web/|schema/live/|backend/src/player_backend/request_policy\.py$|backend/src/player_backend/(rider|control)_page_policy\.py$|backend/tests/test_control_page\.py$|player/app/src/core/clock/(clock|plan|view)\.ts$|player/scene/model/src/flash-marks\.ts$)'
# Something other than documentation changed (a docs-only change sets every flag false, above).
# An empty diff with a known base (an empty or rebased-away change) fails safe: code is true, so the
# script tests and shellcheck run as before (#438).
if [ -z "$files" ]; then echo "code=true" >>"$out"; else flag code '.'; fi
# Plan section 10: player, web, schema, build and packaging scripts, workflow files,
# dependency manifests and lockfiles.
flag desktop '^(player/|web/|schema/|scripts/(build|package|release)[^/]*|\.github/workflows/|(.*/)?(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|uv\.lock|requirements[^/]*\.txt))'
# docs/design/scene.md is the one documentation file with a test: player/scene/model/test/spec-tables.test.ts
# parses its energy and quality tables (#527). A change to it runs the node-packages job even when it is
# the only thing that changed. This is not part of the docs-only rule above, so it is set apart from flag():
# every other documentation change still runs no tests (#437). An unknown base counts as everything.
if [ "$all" -eq 1 ] || printf '%s\n' "$files" | grep -Fxq 'docs/design/scene.md'; then
  echo "scene_spec=true" >>"$out"
else
  echo "scene_spec=false" >>"$out"
fi

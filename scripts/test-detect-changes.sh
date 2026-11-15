#!/usr/bin/env bash
# Tests detect-changes.sh on synthetic commits in a temporary repository.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" "$tmp.out"' EXIT
fail=0
check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]" >&2; fail=1; fi
}

cd "$tmp"
git init -q -b main .
git config user.email t@example.com
git config user.name t
git config commit.gpgsign false
commit() { # commit <path>
  mkdir -p "$(dirname "$1")"
  echo "$RANDOM" >"$1"
  git add -A
  git commit -qm "change $1"
}
flags() { # flags <event> <base> <head>: the true flags, space separated
  local o="$tmp.out"
  : >"$o"
  GITHUB_OUTPUT="$o" EVENT="$1" BASE_SHA="$2" BEFORE_SHA="$2" HEAD_SHA="$3" bash "$here/detect-changes.sh"
  { grep '=true' "$o" | grep -v '^code=' | grep -v '^scene_spec=' || true; } | sed 's/=true//' | tr '\n' ' ' | sed 's/ $//'
}
codeflag() { # codeflag <event> <base> <head>: the `code` output (true or false)
  local o="$tmp.out"
  : >"$o"
  GITHUB_OUTPUT="$o" EVENT="$1" BASE_SHA="$2" BEFORE_SHA="$2" HEAD_SHA="$3" bash "$here/detect-changes.sh"
  grep '^code=' "$o" | sed 's/^code=//'
}

scenefn() { # scenefn <event> <base> <head>: the `scene_spec` output (true or false)
  local o="$tmp.out"
  : >"$o"
  GITHUB_OUTPUT="$o" EVENT="$1" BASE_SHA="$2" BEFORE_SHA="$2" HEAD_SHA="$3" bash "$here/detect-changes.sh"
  grep '^scene_spec=' "$o" | sed 's/^scene_spec=//'
}

commit README.md
fork="$(git rev-parse HEAD)"
git checkout -q -b feature
commit player/a.txt
feature="$(git rev-parse HEAD)"
git checkout -q main
commit web/b.txt
main_tip="$(git rev-parse HEAD)"

check "PR uses the merge base (main's own web change is ignored)" "player desktop" "$(flags pull_request "$main_tip" "$feature")"
check "push compares the two tips" "player desktop" "$(flags push "$fork" "$feature")"
check "push of web only" "web desktop" "$(flags push "$fork" "$main_tip")"
check "all-zero before means everything" "backend schema player android web desktop" "$(flags push 0000000000000000000000000000000000000000 "$feature")"
check "unknown base means everything" "backend schema player android web desktop" "$(flags pull_request deadbeefdeadbeefdeadbeefdeadbeefdeadbeef "$feature")"
commit scripts/other.sh
check "unrelated file sets no flag" "" "$(flags push "$main_tip" HEAD)"
commit schema/class-format/v1/x.json
check "schema change runs backend, schema and desktop" "backend schema desktop" "$(flags push "$(git rev-parse HEAD~1)" HEAD)"
before_wf="$(git rev-parse HEAD)"
commit .github/workflows/ci.yml
check "workflow change runs backend, schema, player and desktop" "backend schema player android desktop" "$(flags push "$before_wf" HEAD)"
before_tok="$(git rev-parse HEAD)"
commit docs/design/mockups/tokens.css
check "design token mock-up change alone runs nothing (documentation only, #435)" "" "$(flags push "$before_tok" HEAD)"
check "documentation only: the code flag is false" "false" "$(codeflag push "$before_tok" HEAD)"
before_docs="$(git rev-parse HEAD)"
commit docs/plan.md
commit docs/design/room-2d.md
commit docs/design/package.json
commit AGENTS.md
check "docs/, docs/design/ and root *.md together run nothing (even a package.json under docs/)" "" "$(flags push "$before_docs" HEAD)"
check "several documentation files: the code flag is false" "false" "$(codeflag push "$before_docs" HEAD)"
check "a pull request of documentation only runs nothing" "" "$(flags pull_request "$before_docs" HEAD)"
commit web/src/x.ts
check "documentation plus one web file runs web and desktop" "web desktop" "$(flags push "$before_docs" HEAD)"
check "documentation plus one web file: the code flag is true" "true" "$(codeflag push "$before_docs" HEAD)"
before_rootmd="$(git rev-parse HEAD)"
commit README.md
check "a root *.md only runs nothing" "" "$(flags push "$before_rootmd" HEAD)"
before_sub="$(git rev-parse HEAD)"
git mv web/src/x.ts docs/moved.ts
git commit -qm "move a web file into docs"
check "moving a web file into docs is not docs-only (--no-renames lists both paths)" "web desktop" "$(flags push "$before_sub" HEAD)"
check "a rename out of web: the code flag is true" "true" "$(codeflag push "$before_sub" HEAD)"
git commit -q --allow-empty -m "empty"
check "an empty diff with a known base: the code flag fails safe (true)" "true" "$(codeflag push HEAD HEAD)"
check "an empty diff sets no other flag" "" "$(flags push HEAD HEAD)"
commit web/notes.md
check "a *.md below web/ is not documentation: it runs web and desktop" "web desktop" "$(flags push "$before_sub" HEAD)"
check "an unknown base still runs everything (the code flag too)" "true" "$(codeflag pull_request deadbeefdeadbeefdeadbeefdeadbeefdeadbeef HEAD)"
before_tok="$(git rev-parse HEAD)"
before_live="$(git rev-parse HEAD)"
commit schema/live/v1/examples/x.json
check "live schema example change runs backend, schema, web and desktop" "backend schema web desktop" "$(flags push "$before_live" HEAD)"
before_pol="$(git rev-parse HEAD)"
commit backend/src/player_backend/request_policy.py
check "request policy change runs backend and web" "backend web" "$(flags push "$before_pol" HEAD)"
before_ctl="$(git rev-parse HEAD)"
commit backend/tests/test_control_page.py
check "control page test change runs backend and web" "backend web" "$(flags push "$before_ctl" HEAD)"
before_rp="$(git rev-parse HEAD)"
commit backend/src/player_backend/rider_page_policy.py
check "rider page policy change runs backend and web" "backend web" "$(flags push "$before_rp" HEAD)"
before_cp="$(git rev-parse HEAD)"
commit backend/src/player_backend/control_page_policy.py
check "control page policy change runs backend and web" "backend web" "$(flags push "$before_cp" HEAD)"
commit backend/src/player_backend/other_page_policy.py
check "another backend source file runs backend only" "backend" "$(flags push "$(git rev-parse HEAD~1)" HEAD)"
commit backend/tests/test_other.py
check "other backend test runs backend only" "backend" "$(flags push "$(git rev-parse HEAD~1)" HEAD)"

for f in clock plan view; do
  before_clk="$(git rev-parse HEAD)"
  commit "player/app/src/core/clock/$f.ts"
  check "shared clock surface $f.ts runs player, web and desktop" "player web desktop" "$(flags push "$before_clk" HEAD)"
done
before_clk="$(git rev-parse HEAD)"
commit player/app/src/core/clock/apply.ts
check "another core/clock file runs player and desktop only" "player desktop" "$(flags push "$before_clk" HEAD)"
before_clk="$(git rev-parse HEAD)"
commit player/app/src/core/other.ts
check "another player file runs player and desktop only" "player desktop" "$(flags push "$before_clk" HEAD)"

before_android="$(git rev-parse HEAD)"
commit player/spikes/android-follower/app/x.kt
check "an Android spike change runs player, android and desktop (#558)" "player android desktop" "$(flags push "$before_android" HEAD)"
before_android="$(git rev-parse HEAD)"
commit player/scene/render/src/z.ts
check "a scene render change also runs android (the APK bundles it)" "player android desktop" "$(flags push "$before_android" HEAD)"

before_scene="$(git rev-parse HEAD)"
commit docs/design/scene.md
check "docs/design/scene.md alone sets scene_spec (#527)" "true" "$(scenefn push "$before_scene" HEAD)"
check "docs/design/scene.md alone sets no lane flag" "" "$(flags push "$before_scene" HEAD)"
check "docs/design/scene.md alone: the code flag is false" "false" "$(codeflag push "$before_scene" HEAD)"
before_scene="$(git rev-parse HEAD)"
commit docs/design/room-2d.md
check "another docs/design file does not set scene_spec" "false" "$(scenefn push "$before_scene" HEAD)"
before_scene="$(git rev-parse HEAD)"
commit docs/design/scene.md.bak
check "a path that only starts like scene.md does not set scene_spec" "false" "$(scenefn push "$before_scene" HEAD)"
check "an unknown base sets scene_spec" "true" "$(scenefn pull_request deadbeefdeadbeefdeadbeefdeadbeefdeadbeef HEAD)"
before_scene="$(git rev-parse HEAD)"
commit web/src/y.ts
check "a web change alone does not set scene_spec" "false" "$(scenefn push "$before_scene" HEAD)"

exit "$fail"

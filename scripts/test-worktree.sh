#!/usr/bin/env bash
# Tests worktree.sh in a temporary repository with a local bare "origin".
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0
check() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]" >&2; fail=1; fi
}

git init -q --bare "$tmp/origin.git"
mkdir "$tmp/work"
cd "$tmp/work"
git init -q -b main .
git config user.email t@example.com
git config user.name t
git config commit.gpgsign false
git remote add origin "$tmp/origin.git"
echo a >a.txt
git add -A
git commit -qm init
git push -q origin main

wt="$tmp/classbeat-player-wt"
has_branch() { if git show-ref --verify --quiet "refs/heads/$1"; then echo yes; else echo no; fi; }
is_dir() { if [ -d "$1" ]; then echo yes; else echo no; fi; }

bash "$here/worktree.sh" new 41 empty >/dev/null 2>&1
check "new creates the worktree" "yes" "$(is_dir "$wt/41-empty")"
check "new writes PORT_OFFSET" "PORT_OFFSET=410" "$(cat "$wt/41-empty/.env")"
check "ls lists it" "1" "$(bash "$here/worktree.sh" ls | grep -c 41-empty)"
bash "$here/worktree.sh" rm 41 >/dev/null
check "rm removes the directory" "no" "$(is_dir "$wt/41-empty")"
check "rm deletes a branch with no commits of its own" "no" "$(has_branch 41-empty)"

bash "$here/worktree.sh" new 42 work >/dev/null 2>&1
(cd "$wt/42-work" && echo b >b.txt && git add -A && git -c user.email=t@example.com -c user.name=t commit -qm work)
out="$(bash "$here/worktree.sh" rm 42)"
check "rm keeps an unmerged branch" "yes" "$(has_branch 42-work)"
check "rm says it kept the branch" "1" "$(printf '%s\n' "$out" | grep -c 'kept branch 42-work')"

bash "$here/worktree.sh" new 43 merged >/dev/null 2>&1
(cd "$wt/43-merged" && echo c >c.txt && git add -A && git -c user.email=t@example.com -c user.name=t commit -qm merged && git push -q origin HEAD:main)
git fetch -q origin main
bash "$here/worktree.sh" rm 43 >/dev/null
check "rm deletes a branch merged into origin/main" "no" "$(has_branch 43-merged)"

if bash "$here/worktree.sh" rm 99 >/dev/null 2>&1; then rc=0; else rc=$?; fi
check "rm of an unknown issue fails" "1" "$rc"

exit "$fail"
